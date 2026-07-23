import { convertFileSrc } from '@tauri-apps/api/core'
import type Webamp from 'webamp'
import type { IFeature } from '../../core/IFeature'
import type { ModuleContext } from '../../core/ModuleContext'
import type { IKVStorage } from '../../core/KVStorage'
import type { ITransport } from '../../services/transport'
import type { Track, PlaybackState } from '../../core/types'
import { EVENTS } from '../../core/events'
import { RecommendationService } from '../../services/RecommendationService'
import { YouTubeSource } from '../../sources/youtube/YouTubeSource'
import { showAutoplayStatus } from './autoplay-status'
import {
  blockTrack, isBlocked, isRated, likeTrack, markNormal, recordTrackSignal,
} from './autoplay-feedback'
import { dismissOnboarding, showOnboardingOnce } from './autoplay-onboarding'
import { hideRateNudge, showRateNudge } from './autoplay-nudge'

/**
 * Infinite playlist. When enabled, the moment a track plays the queue is
 * filled with ~QUEUE_SIZE similar tracks — INSTANTLY, metadata only.
 *
 * No audio is downloaded at append time. Each track's URL points at the
 * custom `goamp-audio://` scheme; the audio is streamed lazily (and cached in
 * the background) by the Rust protocol handler when the track is played.
 * See src-tauri/src/audio_protocol.rs.
 *
 * Recommendations:
 *  - GOAMP's own recommender (hybrid) is preferred.
 *  - The YouTube Mix (RD<id> radio, no API key) bridges the cold-start gap.
 *  - Variety is enforced: at most MAX_PER_ARTIST tracks of one artist per
 *    batch, so the queue is not flooded with the seed band.
 *
 * Queue accounting uses an internal counter (queuedAhead), not the Webamp
 * store — the store's playlist shape is not reliable to read.
 */

// Module-level singleton so the Webamp menu can toggle the feature without
// holding a reference to the GoampCore-managed instance.
let _instance: AutoplayFeature | null = null

export function isAutoplayEnabled(): boolean {
  return _instance?.enabled ?? false
}

export function toggleAutoplay(): void {
  _instance?.toggle()
}

interface RecSeed {
  /** Present for YouTube Mix entries — lets us skip the lookup search. */
  videoId?: string
  artist: string
  title: string
  duration?: number
}

type ResolvedSeed = RecSeed & { videoId: string }

/** Compact track shape persisted to storage so the queue survives restarts. */
interface SavedTrack {
  videoId: string
  artist: string
  title: string
  duration?: number
}

const QUEUE_STORAGE_KEY = 'autoplay:queue'

export class AutoplayFeature implements IFeature {
  readonly id = 'autoplay'

  private readonly recs: RecommendationService
  private readonly youtube: YouTubeSource
  private storage: IKVStorage | null = null
  private cleanups: Array<() => void> = []

  /** Public so the module-level isAutoplayEnabled() can read it. */
  enabled = false
  private filling = false
  /** Probe the streaming protocol once, BEFORE the first batch is appended. */
  private selfTestDone = false
  /** Tripped when playback is clearly broken — stops autoplay refilling so the
   *  queue is not flooded with un-playable tracks. */
  private circuitBroken = false
  /** Recent TRACK_START timestamps, for the rapid-skip circuit breaker. */
  private recentStarts: number[] = []
  /** The track currently playing — from the TRACK_START event (reliable
   *  metadata), used as the recommendation seed. */
  private currentTrack: Track | null = null
  /** Our own estimate of how many autoplay tracks are still queued ahead. */
  private queuedAhead = 0
  /** "artist|title" keys already queued — avoids recommending the same track twice. */
  private readonly seen = new Set<string>()
  /** Un-resolved recommendation metadata, fetched in bulk, drained per batch. */
  private pool: RecSeed[] = []
  /** Mirror of tracks we've appended that are still ahead — persisted to
   *  storage so the queue survives an app restart. */
  private appended: SavedTrack[] = []

  /** Refill once fewer than this many autoplay tracks remain queued. */
  private readonly LOW_WATERMARK = 3
  /** Target number of similar tracks to keep queued ahead. */
  private readonly QUEUE_SIZE = 20
  /** Refetch recommendation metadata when the pool drops below this. */
  private readonly POOL_MIN = 20
  /** Max tracks of one artist per batch — keeps the queue varied. */
  private readonly MAX_PER_ARTIST = 2
  /** Prompt the user to rate the current track every N autoplay tracks. */
  private readonly NUDGE_EVERY = 5
  /** Autoplay tracks played since the last nudge. */
  private nudgeCounter = 0

  constructor(
    private readonly webamp: Webamp,
    transport: ITransport,
  ) {
    this.recs = new RecommendationService(transport)
    this.youtube = new YouTubeSource(transport)
  }

  async init(ctx: ModuleContext): Promise<void> {
    _instance = this
    this.storage = ctx.storage
    this.enabled = ctx.storage.get<string>('autoplay') === '1'

    // Restore the autoplay queue from the previous session, if any.
    this.restoreSavedQueue()

    // If autoplay is already on (carried from a previous session), still show
    // the onboarding once so old users get the rating-hotkey explainer.
    if (this.enabled) showOnboardingOnce()

    this.cleanups.push(
      ctx.events.on<Track>(EVENTS.TRACK_START, (track) => {
        if (track) {
          // The TRACK_START payload is the reliable source of the current
          // track's metadata — the Webamp store is not.
          this.currentTrack = track
          this.seen.add(seedKey(track.artist, track.title))

          if (isAutoplayUrl(track.sourceId) || isAutoplayUrl(track.streamUrl)) {
            // An autoplay-queued track advanced — one fewer ahead.
            this.queuedAhead = Math.max(0, this.queuedAhead - 1)
            // …and one fewer in the persisted mirror.
            this.appended.shift()
            this.persistQueue()

            // Periodic rating nudge: every NUDGE_EVERY autoplay tracks, if
            // the current one isn't rated yet, ask the user to rate it.
            this.nudgeCounter += 1
            if (this.nudgeCounter >= this.NUDGE_EVERY && !isRated(track.artist, track.title)) {
              this.nudgeCounter = 0
              showRateNudge()
            } else if (isRated(track.artist, track.title)) {
              // Track is already rated — don't keep the previous nudge up.
              hideRateNudge()
            }
          } else {
            // A freshly user-picked track — the queue was replaced; reset.
            this.queuedAhead = 0
            this.appended = []
            this.persistQueue()
            this.nudgeCounter = 0
          }
        }

        // Rapid-skip circuit breaker: if tracks fly by, playback is failing
        // and refilling only makes it worse — stop.
        const now = Date.now()
        this.recentStarts = this.recentStarts.filter((t) => now - t < 10_000)
        this.recentStarts.push(now)
        if (this.recentStarts.length > 8 && !this.circuitBroken) {
          this.circuitBroken = true
          showAutoplayStatus('STOPPED — tracks keep skipping (playback is failing)', true)
          return
        }

        void this.maybeRefill()
      }),
    )

    // Catch the queue-ended case: Webamp does NOT fire TRACK_START when the
    // last track finishes (there is no next track). Listening to PLAYBACK_CHANGE
    // → STOPPED lets us attempt one more refill so the music continues.
    this.cleanups.push(
      ctx.events.on<PlaybackState>(EVENTS.PLAYBACK_CHANGE, (state) => {
        if (state.status === 'STOPPED' && this.enabled && !this.circuitBroken) {
          void this.maybeRefill()
        }
      }),
    )

    // Auto-feedback: when an autoplay track ENDS, infer the user's opinion
    // from how they listened. Skipped very early → dislike (track did not
    // catch them). Listened through → like. Manual L/D/N always wins —
    // never overwrite an explicit rating.
    this.cleanups.push(
      ctx.events.on<{ track: Track; timeElapsed: number }>(
        EVENTS.TRACK_END,
        ({ track, timeElapsed }) => {
          if (!track || (!track.artist && !track.title)) return
          if (!isAutoplayUrl(track.sourceId) && !isAutoplayUrl(track.streamUrl)) return
          if (isRated(track.artist, track.title)) return
          const duration = track.duration ?? 0
          if (timeElapsed < 10 && duration > 15) {
            blockTrack(track.artist, track.title)
            void recordTrackSignal(track, -1)
          } else if (duration > 0 && timeElapsed >= duration * 0.8) {
            likeTrack(track.artist, track.title)
            void recordTrackSignal(track, +1)
          }
        },
      ),
    )

    // Hotkeys L / D / N — like / dislike / normal on the currently playing
    // track. Per-track granularity: the user marks one specific track.
    // Blocked tracks never come back; "normal" counts as rated so the nudge
    // does not re-ask. Any of these dismisses the onboarding card too.
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      const tgt = e.target as HTMLElement | null
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k !== 'l' && k !== 'd' && k !== 'n') return
      const t = this.currentTrack
      if (!t || (!t.artist && !t.title)) return
      e.preventDefault()
      dismissOnboarding()
      hideRateNudge()
      if (k === 'l') {
        likeTrack(t.artist, t.title)
        void recordTrackSignal(t, +1)
        showAutoplayStatus(`✓ liked: ${t.artist} — ${t.title}`)
      } else if (k === 'd') {
        blockTrack(t.artist, t.title)
        void recordTrackSignal(t, -1)
        showAutoplayStatus(`✗ blocked: ${t.artist} — ${t.title}`)
      } else {
        // "Normal" is a local-only state — no backend signal sent.
        markNormal(t.artist, t.title)
        showAutoplayStatus(`· normal: ${t.artist} — ${t.title}`)
      }
    }
    document.addEventListener('keydown', onKey)
    this.cleanups.push(() => document.removeEventListener('keydown', onKey))
  }

  destroy(): void {
    if (_instance === this) _instance = null
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
  }

  toggle(): void {
    this.setEnabled(!this.enabled)
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    this.storage?.set('autoplay', on ? '1' : '0')
    if (on) {
      // Re-enabling gives the pipeline a fresh chance.
      this.circuitBroken = false
      this.recentStarts = []
      // First enable → show the rating-hotkey onboarding.
      showOnboardingOnce()
    }
    showAutoplayStatus(on ? 'ON — keeping the queue filled' : 'OFF')
    if (on) void this.maybeRefill()
  }

  private async maybeRefill(): Promise<void> {
    if (!this.enabled || this.filling || this.circuitBroken) return
    // Enough already queued — nothing to do (this is what stops the flood).
    if (this.queuedAhead >= this.LOW_WATERMARK) return

    this.filling = true
    try {
      showAutoplayStatus(
        this.currentTrack?.artist
          ? `finding tracks like ${this.currentTrack.artist}…`
          : 'finding recommendations…',
        true,
      )
      await this.ensurePool()

      const batch = this.takeBatch(this.QUEUE_SIZE - this.queuedAhead)
      if (batch.length === 0) {
        showAutoplayStatus('no recommendations found (check internet connection)')
        return
      }

      const ready = await this.resolveVideoIds(batch)
      if (ready.length === 0) {
        showAutoplayStatus('found recommendations but could not resolve them')
        return
      }

      // GATE: probe the streaming protocol ONCE before ever appending tracks.
      // If it is broken, do NOT flood the queue with un-playable tracks (that
      // is what caused the endless skipping).
      if (!this.selfTestDone) {
        this.selfTestDone = true
        const ok = await this.selfTestPlayback(ready[0].videoId)
        if (!ok) {
          this.circuitBroken = true // selfTestPlayback already showed the reason
          return
        }
      }

      this.appendAll(ready)
      this.queuedAhead += ready.length
      showAutoplayStatus(`added ${ready.length} similar tracks — audio streams when played`)
    } catch (e) {
      showAutoplayStatus(`failed — ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.filling = false
    }
  }

  /**
   * Top up the metadata pool — cheap, no downloads. GOAMP's own recommender
   * (hybrid) is preferred; the YouTube Mix bridges the cold-start gap.
   */
  private async ensurePool(): Promise<void> {
    if (this.pool.length >= this.POOL_MIN) return

    const hybrid = await this.recs.getRecommendations(30).catch(() => [])
    for (const r of hybrid) {
      if (r.artist && r.title && !this.seen.has(seedKey(r.artist, r.title))) {
        this.pool.push({ artist: r.artist, title: r.title })
      }
    }

    if (this.pool.length < this.POOL_MIN) {
      const cur = this.currentTrack
      if (cur && (cur.artist || cur.title)) {
        const mix = await this.youtubeMix({ artist: cur.artist, title: cur.title }).catch(() => [])
        for (const s of mix) {
          if (!this.seen.has(seedKey(s.artist, s.title))) this.pool.push(s)
        }
      }
    }
  }

  /**
   * Take up to `n` fresh seeds from the pool, at most MAX_PER_ARTIST of any one
   * artist (variety). Picked seeds are removed from the pool and marked seen.
   */
  private takeBatch(n: number): RecSeed[] {
    if (n <= 0) return []
    const perArtist = new Map<string, number>()
    const picked: RecSeed[] = []
    const rest: RecSeed[] = []

    for (const s of this.pool) {
      const key = seedKey(s.artist, s.title)
      const aKey = (s.artist ?? '').toLowerCase().trim()
      const artistCount = perArtist.get(aKey) ?? 0
      if (
        picked.length < n &&
        !this.seen.has(key) &&
        (s.artist || s.title) &&
        artistCount < this.MAX_PER_ARTIST &&
        !isBlocked(s.artist, s.title) // user-blocked tracks never come back
      ) {
        picked.push(s)
        perArtist.set(aKey, artistCount + 1)
        this.seen.add(key)
      } else {
        rest.push(s)
      }
    }

    this.pool = rest
    return picked
  }

  /**
   * Cold-start recommendations from YouTube for the current track. Tries the
   * YouTube Mix radio for varied artists; falls back to a same-artist search.
   */
  private async youtubeMix(current: { artist: string; title: string }): Promise<RecSeed[]> {
    const query = `${current.artist} ${current.title}`.trim()

    const found = await this.youtube.search(query).catch(() => [])
    const seedId = found[0]?.track.sourceId

    if (seedId) {
      const mix = await this.youtube.relatedMix(seedId).catch(() => [])
      if (mix.length > 0) return mix.map(trackToSeed)
    }

    const byArtist = await this.youtube.search(current.artist).catch(() => [])
    return byArtist.map((r) => trackToSeed(r.track))
  }

  /**
   * Make sure every seed has a YouTube video id. Mix seeds already do; hybrid
   * seeds (artist/title only) get a quick search. Parallel — these are
   * lightweight lookups, NOT downloads.
   */
  private async resolveVideoIds(seeds: RecSeed[]): Promise<ResolvedSeed[]> {
    const out = await Promise.all(
      seeds.map(async (s): Promise<ResolvedSeed | null> => {
        if (s.videoId) return { ...s, videoId: s.videoId }
        const results = await this.youtube.search(`${s.artist} ${s.title}`).catch(() => [])
        const id = results[0]?.track.sourceId
        return id ? { ...s, videoId: id } : null
      }),
    )
    return out.filter((s): s is ResolvedSeed => s !== null)
  }

  /**
   * Append every seed to the Webamp queue at once — INSTANT, no downloads.
   * The URL uses the goampaudio:// scheme; audio is streamed lazily by the
   * Rust protocol handler when the track is played.
   */
  private appendAll(seeds: ResolvedSeed[]): void {
    const tracks = seeds.map((s) => ({
      url: convertFileSrc(s.videoId, 'goampaudio'),
      duration: s.duration,
      metaData: { artist: s.artist, title: s.title },
    }))
    ;(this.webamp as { appendTracks: (t: unknown[]) => void }).appendTracks(tracks)

    for (const s of seeds) {
      this.appended.push({
        videoId: s.videoId, artist: s.artist, title: s.title, duration: s.duration,
      })
    }
    this.persistQueue()
  }

  /** Restore the autoplay queue saved during the previous session. */
  private restoreSavedQueue(): void {
    const saved = this.storage?.get<SavedTrack[]>(QUEUE_STORAGE_KEY)
    if (!Array.isArray(saved) || saved.length === 0) return
    const tracks = saved.map((s) => ({
      url: convertFileSrc(s.videoId, 'goampaudio'),
      duration: s.duration,
      metaData: { artist: s.artist, title: s.title },
    }))
    ;(this.webamp as { appendTracks: (t: unknown[]) => void }).appendTracks(tracks)
    this.appended = [...saved]
    this.queuedAhead = saved.length
    // Mark them seen so the next refill does not re-recommend them.
    for (const s of saved) this.seen.add(seedKey(s.artist, s.title))
  }

  private persistQueue(): void {
    this.storage?.set(QUEUE_STORAGE_KEY, this.appended)
  }

  /**
   * Probe the streaming protocol with a tiny range request. Returns true if the
   * pipeline works. Reports a concrete reason on failure — this is the gate
   * that stops a broken pipeline from flooding the queue with dead tracks.
   */
  private async selfTestPlayback(videoId: string): Promise<boolean> {
    showAutoplayStatus('testing playback protocol…', true)
    const url = convertFileSrc(videoId, 'goampaudio')
    try {
      const resp = await fetch(url, { headers: { Range: 'bytes=0-1' } })
      if (resp.ok || resp.status === 206) {
        showAutoplayStatus('playback protocol OK ✓', true)
        return true
      }
      const body = await resp.text().catch(() => '')
      showAutoplayStatus(`playback BROKEN — HTTP ${resp.status}: ${body.slice(0, 140)}`, true)
      return false
    } catch (e) {
      showAutoplayStatus(
        `playback BROKEN — protocol unreachable: ${e instanceof Error ? e.message : String(e)}`,
        true,
      )
      return false
    }
  }
}

function seedKey(artist?: string, title?: string): string {
  return `${(artist ?? '').toLowerCase().trim()}|${(title ?? '').toLowerCase().trim()}`
}

function trackToSeed(t: Track): RecSeed {
  return { videoId: t.sourceId, artist: t.artist, title: t.title, duration: t.duration }
}

/** True if a track URL was produced by autoplay (the goampaudio:// scheme). */
function isAutoplayUrl(url?: string): boolean {
  return (url ?? '').includes('goampaudio')
}
