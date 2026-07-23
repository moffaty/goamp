/**
 * Local per-track feedback on autoplay recommendations.
 *
 * The user dislikes/likes a SPECIFIC track. Blocked tracks are filtered from
 * future autoplay batches. Likes are recorded for future ranking. Persisted
 * to localStorage for fast lookup — no backend round-trip.
 *
 * `recordTrackSignal` additionally bridges the signal into GOAMP's backend
 * `track_signals` table so the mood / hybrid recommender learns too.
 */

import { invoke } from '@tauri-apps/api/core'

const BLOCKED_KEY = 'autoplay:blocked'
const LIKED_KEY = 'autoplay:liked'
/** Tracks the user explicitly marked as "neutral / no opinion" — counted as
 *  rated so the periodic nudge does not re-ask. */
const NORMAL_KEY = 'autoplay:normal'

let blocked: Set<string> | null = null
let liked: Set<string> | null = null
let normalMarked: Set<string> | null = null

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? (arr as string[]) : [])
  } catch {
    return new Set()
  }
}

function save(key: string, s: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...s]))
  } catch {
    /* quota exceeded — ignore */
  }
}

function ensureBlocked(): Set<string> {
  if (!blocked) blocked = load(BLOCKED_KEY)
  return blocked
}

function ensureLiked(): Set<string> {
  if (!liked) liked = load(LIKED_KEY)
  return liked
}

function ensureNormal(): Set<string> {
  if (!normalMarked) normalMarked = load(NORMAL_KEY)
  return normalMarked
}

/** Canonical key — same form AutoplayFeature uses internally. */
export function feedbackKey(artist?: string, title?: string): string {
  return `${(artist ?? '').toLowerCase().trim()}|${(title ?? '').toLowerCase().trim()}`
}

export function isBlocked(artist?: string, title?: string): boolean {
  if (!artist && !title) return false
  return ensureBlocked().has(feedbackKey(artist, title))
}

export function isLiked(artist?: string, title?: string): boolean {
  if (!artist && !title) return false
  return ensureLiked().has(feedbackKey(artist, title))
}

export function isNormalMarked(artist?: string, title?: string): boolean {
  if (!artist && !title) return false
  return ensureNormal().has(feedbackKey(artist, title))
}

/** True if the user has marked the track in any way (like, dislike, normal). */
export function isRated(artist?: string, title?: string): boolean {
  return isLiked(artist, title) || isBlocked(artist, title) || isNormalMarked(artist, title)
}

/** Mark a track as disliked. Removes it from likes/normal if it was there. */
export function blockTrack(artist: string, title: string): void {
  if (!artist && !title) return
  const key = feedbackKey(artist, title)
  const b = ensureBlocked()
  if (b.has(key)) return
  b.add(key)
  save(BLOCKED_KEY, b)
  const l = ensureLiked()
  if (l.delete(key)) save(LIKED_KEY, l)
  const n = ensureNormal()
  if (n.delete(key)) save(NORMAL_KEY, n)
}

/** Mark a track as liked. Removes it from blocks/normal if it was there. */
export function likeTrack(artist: string, title: string): void {
  if (!artist && !title) return
  const key = feedbackKey(artist, title)
  const l = ensureLiked()
  if (l.has(key)) return
  l.add(key)
  save(LIKED_KEY, l)
  const b = ensureBlocked()
  if (b.delete(key)) save(BLOCKED_KEY, b)
  const n = ensureNormal()
  if (n.delete(key)) save(NORMAL_KEY, n)
}

/**
 * Mark a track as "normal / no opinion". Counts as rated so the periodic
 * nudge no longer asks about it. Removes from likes/blocks if it was there.
 */
export function markNormal(artist: string, title: string): void {
  if (!artist && !title) return
  const key = feedbackKey(artist, title)
  const n = ensureNormal()
  if (n.has(key)) return
  n.add(key)
  save(NORMAL_KEY, n)
  const l = ensureLiked()
  if (l.delete(key)) save(LIKED_KEY, l)
  const b = ensureBlocked()
  if (b.delete(key)) save(BLOCKED_KEY, b)
}

/** Drop cached state — for tests. */
export function __resetFeedback(): void {
  blocked = null
  liked = null
  normalMarked = null
}

// ── Backend bridge ───────────────────────────────────────────────────────

export interface TrackForSignal {
  artist: string
  title: string
  source?: string
  sourceId?: string
  duration?: number
}

/** Strip a `goampaudio://…/<videoId>` URL down to the bare video id. */
function videoIdFromSourceId(sourceId?: string): string {
  if (!sourceId) return ''
  if (!sourceId.includes('goampaudio')) return sourceId
  return sourceId
    .split(/[?#]/)[0]!
    .replace(/\/+$/, '')
    .split('/')
    .pop() ?? ''
}

/**
 * Bridge a user (or auto) signal to GOAMP's backend `track_signals` table so
 * the mood/hybrid recommender learns from autoplay feedback. Best-effort —
 * any failure (no backend, no canonical id) is silently swallowed: the local
 * block/like state is the source of truth for autoplay filtering.
 */
export async function recordTrackSignal(
  track: TrackForSignal,
  signal: -1 | 1,
): Promise<void> {
  if (!track.artist && !track.title) return
  try {
    const canonicalId = await invoke<string>('resolve_track_id', {
      source: track.source ?? 'youtube',
      sourceId: videoIdFromSourceId(track.sourceId),
      artist: track.artist ?? '',
      title: track.title ?? '',
      duration: track.duration ?? 0,
    })
    if (!canonicalId) return
    await invoke('record_track_signal', {
      canonicalId,
      signal,
      scope: 'global',
    })
  } catch {
    /* best-effort — local state already updated */
  }
}
