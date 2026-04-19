# Frontend Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `bridge.ts` / flat `tauri-ipc.ts` pattern with a typed service layer so frontend changes are isolated, testable without Tauri, and ready for HTTP transport.

**Architecture:** A `PlayerStore` class owns all `(webamp as any).store` access. An `ITransport` interface abstracts `invoke()` — `TauriTransport` wraps it for production, `MockTransport` enables unit tests. Domain services (`PlaylistService`, `ScrobbleService`, etc.) implement typed interfaces and receive an `ITransport` in their constructor. `AppBootstrap` replaces `bridge.ts` as thin wiring.

**Tech Stack:** TypeScript, Vitest, Webamp (internal Redux store), `@tauri-apps/api/core` invoke

---

## File Map

**Create:**
- `src/player/PlayerStore.ts` — single class owning all `(webamp as any)` access
- `src/player/PlayerStore.test.ts`
- `src/player/PlayerEvents.ts` — typed event emitter wrapping `webamp.onTrackDidChange`
- `src/player/PlayerEvents.test.ts`
- `src/services/transport.ts` — `ITransport`, `TauriTransport`, `MockTransport`
- `src/services/transport.test.ts`
- `src/services/interfaces.ts` — all service TypeScript interfaces
- `src/services/PlaylistService.ts`
- `src/services/PlaylistService.test.ts`
- `src/services/ScrobbleService.ts` — replaces `src/scrobble/scrobble-service.ts` + orchestration from bridge.ts
- `src/services/ScrobbleService.test.ts`
- `src/services/HistoryService.ts` — wraps track-id / history / survey commands + orchestration from bridge.ts
- `src/services/HistoryService.test.ts`
- `src/services/RadioService.ts`
- `src/services/RadioService.test.ts`
- `src/services/RecommendationService.ts` — replaces `src/recommendations/recommendation-service.ts`
- `src/services/RecommendationService.test.ts`
- `src/services/SettingsService.ts` — feature flags + YouTube cookies
- `src/services/SettingsService.test.ts`
- `src/services/index.ts` — instantiates all services with TauriTransport
- `src/bootstrap/AppBootstrap.ts` — replaces `src/webamp/bridge.ts`
- `src/bootstrap/session.ts` — session save/restore
- `src/bootstrap/keyboard.ts` — keyboard shortcuts

**Modify:**
- `src/main.ts` — use `AppBootstrap` instead of `setupBridge`

**Delete (at end):**
- `src/webamp/bridge.ts`
- `src/scrobble/scrobble-service.ts`
- `src/recommendations/recommendation-service.ts`

---

## Task 1: PlayerStore

**Files:**
- Create: `src/player/PlayerStore.ts`
- Create: `src/player/PlayerStore.test.ts`

- [ ] **Write failing test**

```ts
// src/player/PlayerStore.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PlayerStore } from './PlayerStore'

function makeWebamp(storeState: object) {
  const store = {
    getState: () => storeState,
    dispatch: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  }
  return {
    store,
    onTrackDidChange: vi.fn(() => vi.fn()),
  } as any
}

describe('PlayerStore', () => {
  it('getStatus returns STOPPED when no state', () => {
    const w = makeWebamp({})
    const s = new PlayerStore(w)
    expect(s.getStatus()).toBe('STOPPED')
  })

  it('getStatus returns PLAYING from media.status', () => {
    const w = makeWebamp({ media: { status: 'PLAYING' } })
    const s = new PlayerStore(w)
    expect(s.getStatus()).toBe('PLAYING')
  })

  it('getTimeElapsed returns 0 when no state', () => {
    const w = makeWebamp({})
    const s = new PlayerStore(w)
    expect(s.getTimeElapsed()).toBe(0)
  })

  it('getTimeElapsed returns value from media.timeElapsed', () => {
    const w = makeWebamp({ media: { timeElapsed: 42 } })
    const s = new PlayerStore(w)
    expect(s.getTimeElapsed()).toBe(42)
  })

  it('dispatch calls store.dispatch', () => {
    const w = makeWebamp({})
    const s = new PlayerStore(w)
    s.dispatch({ type: 'PLAY' })
    expect(w.store.dispatch).toHaveBeenCalledWith({ type: 'PLAY' })
  })

  it('getTracks returns ordered tracks', () => {
    const w = makeWebamp({
      playlist: {
        tracks: { a: { url: '/a.mp3', title: 'A' }, b: { url: '/b.mp3', title: 'B' } },
        trackOrder: ['b', 'a'],
      },
    })
    const s = new PlayerStore(w)
    const tracks = s.getTracks()
    expect(tracks[0].id).toBe('b')
    expect(tracks[1].id).toBe('a')
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/player/PlayerStore.test.ts
```
Expected: FAIL — `PlayerStore` not found.

- [ ] **Implement PlayerStore**

```ts
// src/player/PlayerStore.ts
import type Webamp from 'webamp'

export type PlayerStatus = 'PLAYING' | 'PAUSED' | 'STOPPED'

export interface TrackInfo {
  url: string
  duration?: number
  metaData?: { artist?: string; title?: string }
}

export interface RawTrack {
  id: string
  url: string
  title?: string
  artist?: string
  duration?: number
  defaultName?: string
}

export interface PlayerAction {
  type: string
  [key: string]: unknown
}

export class PlayerStore {
  constructor(private webamp: Webamp) {}

  private get store(): any {
    return (this.webamp as any).store
  }

  private get state(): any {
    return this.store?.getState() ?? {}
  }

  getStatus(): PlayerStatus {
    return this.state?.media?.status ?? 'STOPPED'
  }

  getTimeElapsed(): number {
    return this.state?.media?.timeElapsed ?? 0
  }

  getTracks(): RawTrack[] {
    const tracks = this.state?.playlist?.tracks ?? {}
    const order: string[] = this.state?.playlist?.trackOrder ?? []
    return order.map((id: string) => ({ id, ...tracks[id] })).filter(Boolean)
  }

  dispatch(action: PlayerAction): void {
    this.store?.dispatch(action)
  }

  isMilkdropOpen(): boolean {
    return this.state?.windows?.genWindows?.milkdrop?.open ?? false
  }

  onTrackChange(cb: (track: TrackInfo | null) => void): () => void {
    return this.webamp.onTrackDidChange(cb as any) ?? (() => {})
  }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/player/PlayerStore.test.ts
```
Expected: PASS (5 tests).

- [ ] **Commit**

```bash
git add src/player/PlayerStore.ts src/player/PlayerStore.test.ts
git commit -m "feat: add PlayerStore — single owner of webamp internal store access"
```

---

## Task 2: PlayerEvents

**Files:**
- Create: `src/player/PlayerEvents.ts`
- Create: `src/player/PlayerEvents.test.ts`

- [ ] **Write failing test**

```ts
// src/player/PlayerEvents.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PlayerEvents } from './PlayerEvents'
import type { TrackInfo } from './PlayerStore'

function makeStore(onTrackChange: (cb: any) => () => void) {
  return { onTrackChange } as any
}

describe('PlayerEvents', () => {
  it('calls subscriber when track changes', () => {
    let storedCb: ((t: TrackInfo | null) => void) | null = null
    const store = makeStore((cb) => { storedCb = cb; return () => {} })
    const events = new PlayerEvents(store)

    const listener = vi.fn()
    events.onTrackChange(listener)

    const track: TrackInfo = { url: '/a.mp3', metaData: { artist: 'A', title: 'B' } }
    storedCb!(track)

    expect(listener).toHaveBeenCalledWith(track)
  })

  it('supports multiple subscribers', () => {
    let storedCb: ((t: TrackInfo | null) => void) | null = null
    const store = makeStore((cb) => { storedCb = cb; return () => {} })
    const events = new PlayerEvents(store)

    const a = vi.fn(), b = vi.fn()
    events.onTrackChange(a)
    events.onTrackChange(b)
    storedCb!(null)

    expect(a).toHaveBeenCalledWith(null)
    expect(b).toHaveBeenCalledWith(null)
  })

  it('unsubscribe removes listener', () => {
    let storedCb: ((t: TrackInfo | null) => void) | null = null
    const store = makeStore((cb) => { storedCb = cb; return () => {} })
    const events = new PlayerEvents(store)

    const listener = vi.fn()
    const unsub = events.onTrackChange(listener)
    unsub()
    storedCb!(null)

    expect(listener).not.toHaveBeenCalled()
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/player/PlayerEvents.test.ts
```

- [ ] **Implement PlayerEvents**

```ts
// src/player/PlayerEvents.ts
import type { PlayerStore, TrackInfo } from './PlayerStore'

type TrackChangeListener = (track: TrackInfo | null) => void

export class PlayerEvents {
  private listeners: TrackChangeListener[] = []

  constructor(store: PlayerStore) {
    store.onTrackChange((track) => {
      for (const cb of this.listeners) cb(track)
    })
  }

  onTrackChange(cb: TrackChangeListener): () => void {
    this.listeners.push(cb)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb)
    }
  }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/player/PlayerEvents.test.ts
```

- [ ] **Commit**

```bash
git add src/player/PlayerEvents.ts src/player/PlayerEvents.test.ts
git commit -m "feat: add PlayerEvents — typed event bus over webamp.onTrackDidChange"
```

---

## Task 3: Transport Layer

**Files:**
- Create: `src/services/transport.ts`
- Create: `src/services/transport.test.ts`

- [ ] **Write failing test**

```ts
// src/services/transport.test.ts
import { describe, it, expect } from 'vitest'
import { MockTransport } from './transport'

describe('MockTransport', () => {
  it('records calls and returns set response', async () => {
    const t = new MockTransport()
    t.setResponse('my_cmd', 42)
    const result = await t.call<number>('my_cmd', { x: 1 })
    expect(result).toBe(42)
    expect(t.lastCall).toEqual({ command: 'my_cmd', args: { x: 1 } })
  })

  it('throws when response is an Error', async () => {
    const t = new MockTransport()
    t.setResponse('boom', new Error('oops'))
    await expect(t.call('boom')).rejects.toThrow('oops')
  })

  it('reset clears call history', async () => {
    const t = new MockTransport()
    t.setResponse('cmd', null)
    await t.call('cmd')
    t.reset()
    expect(t.calls).toHaveLength(0)
  })

  it('returns undefined for unset commands', async () => {
    const t = new MockTransport()
    const result = await t.call('unknown')
    expect(result).toBeUndefined()
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/services/transport.test.ts
```

- [ ] **Implement transport**

```ts
// src/services/transport.ts
import { invoke } from '@tauri-apps/api/core'

export interface ITransport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

export class TauriTransport implements ITransport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return invoke<T>(command, args)
  }
}

export class MockTransport implements ITransport {
  calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  private responses = new Map<string, unknown>()

  setResponse(command: string, value: unknown): void {
    this.responses.set(command, value)
  }

  async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    this.calls.push({ command, args })
    const response = this.responses.get(command)
    if (response instanceof Error) throw response
    return response as T
  }

  get lastCall() {
    return this.calls[this.calls.length - 1]
  }

  reset(): void {
    this.calls = []
    this.responses.clear()
  }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/services/transport.test.ts
```

- [ ] **Commit**

```bash
git add src/services/transport.ts src/services/transport.test.ts
git commit -m "feat: add ITransport + TauriTransport + MockTransport"
```

---

## Task 4: Service Interfaces

**Files:**
- Create: `src/services/interfaces.ts`

No tests — pure type declarations.

- [ ] **Write interfaces.ts**

```ts
// src/services/interfaces.ts
import type { ITransport } from './transport'

// ── Re-export types used across services ──────────────────────────────────────

export interface Playlist {
  id: string
  name: string
  created_at: number
  updated_at: number
  track_count: number
}

export interface PlaylistTrack {
  id: string
  position: number
  title: string
  artist: string
  duration: number
  source: string
  source_id: string
  album: string
  original_title: string
  original_artist: string
  cover: string
  genre: string
}

export interface TrackInput {
  title: string
  artist: string
  duration: number
  source: string
  source_id: string
  album?: string
  original_title?: string
  original_artist?: string
  cover?: string
  genre?: string
}

export interface RadioStation {
  stationuuid: string
  name: string
  url: string
  url_resolved: string
  homepage: string
  favicon: string
  tags: string
  country: string
  countrycode: string
  language: string
  codec: string
  bitrate: number
  votes: number
  clickcount: number
}

export interface RadioTag {
  name: string
  stationcount: number
}

export interface RadioNowPlaying {
  title: string
  station_name: string
  station_uuid: string
}

export interface CachedSegment {
  index: number
  title: string
  duration_secs: number
}

export interface MoodChannel {
  id: string
  name: string
  description: string
  seed_tracks: string[]
  is_default: boolean
}

export interface Survey {
  id: number
  survey_type: string
  payload: string
  created_at: number
}

export interface ListenStats {
  canonical_id: string
  listen_count: number
  completed_count: number
  liked: boolean | null
}

export interface Recommendation {
  canonicalId: string
  score: number
  source: string
  artist: string
  title: string
}

export interface FeatureFlag {
  key: string
  enabled: boolean
  description: string
}

export interface ScrobbleStatus {
  lastfm: boolean
  listenbrainz: boolean
  queue_count: number
}

// ── Service interfaces ─────────────────────────────────────────────────────────

export interface IPlaylistService {
  create(name: string): Promise<Playlist>
  list(): Promise<Playlist[]>
  getTracks(playlistId: string): Promise<PlaylistTrack[]>
  addTrack(playlistId: string, track: TrackInput): Promise<PlaylistTrack>
  removeTrack(trackId: string): Promise<void>
  delete(playlistId: string): Promise<void>
  saveSession(tracks: TrackInput[]): Promise<void>
  loadSession(): Promise<PlaylistTrack[]>
  renameTrack(trackId: string, title?: string, artist?: string): Promise<void>
  updateTrackSource(trackId: string, source: string, sourceId: string): Promise<void>
  listGenres(): Promise<string[]>
  getTracksByGenre(genre: string): Promise<PlaylistTrack[]>
}

export interface IScrobbleService {
  lastfmSaveSettings(apiKey: string, secret: string): Promise<void>
  lastfmGetAuthUrl(): Promise<string>
  lastfmAuth(token: string): Promise<{ name: string; key: string }>
  lastfmGetStatus(): Promise<string | null>
  lastfmNowPlaying(artist: string, title: string, duration?: number): Promise<void>
  lastfmScrobble(artist: string, title: string, timestamp: number, duration?: number): Promise<void>
  listenbrainzSaveToken(token: string): Promise<string>
  listenbrainzGetStatus(): Promise<string | null>
  listenbrainzLogout(): Promise<void>
  listenbrainzNowPlaying(artist: string, title: string): Promise<void>
  listenbrainzScrobble(artist: string, title: string, timestamp: number, duration?: number): Promise<void>
  getStatus(): Promise<ScrobbleStatus>
  flushQueue(): Promise<number>
}

export interface IHistoryService {
  resolveTrackId(source: string, sourceId: string, artist: string, title: string, duration: number): Promise<string>
  recordListen(canonicalId: string, source: string, startedAt: number, durationSecs: number, listenedSecs: number, completed: boolean, skippedEarly: boolean): Promise<void>
  setLike(canonicalId: string, liked: boolean): Promise<void>
  removeLike(canonicalId: string): Promise<void>
  getStats(canonicalId: string): Promise<ListenStats>
  getLikedTracks(): Promise<string[]>
  surveyGetPending(): Promise<Survey | null>
  surveyRespond(id: number, response: string): Promise<void>
  surveySkip(id: number): Promise<void>
  surveyMarkShown(id: number): Promise<void>
}

export interface IRadioService {
  search(query: string, tag?: string, country?: string, limit?: number): Promise<RadioStation[]>
  topStations(limit?: number): Promise<RadioStation[]>
  byTag(tag: string, limit?: number): Promise<RadioStation[]>
  tags(): Promise<RadioTag[]>
  addFavorite(station: RadioStation): Promise<void>
  removeFavorite(stationuuid: string): Promise<void>
  listFavorites(): Promise<RadioStation[]>
  addCustom(name: string, url: string, tags?: string): Promise<void>
  removeCustom(id: string): Promise<void>
  listCustom(): Promise<RadioStation[]>
  play(station: RadioStation): Promise<string>
  stop(): Promise<void>
  nowPlaying(): Promise<RadioNowPlaying | null>
  listCached(): Promise<CachedSegment[]>
  saveSegment(index: number, title?: string): Promise<string>
  saveLastSecs(secs: number, title?: string): Promise<string>
}

export interface IRecommendationService {
  syncProfile(): Promise<number>
  getRecommendations(limit?: number): Promise<Recommendation[]>
  getColdstart(artist: string, title: string, limit?: number): Promise<[string, string, number][]>
  listMoodChannels(): Promise<MoodChannel[]>
  createMoodChannel(name: string, description: string): Promise<MoodChannel>
  addSeedTrack(channelId: string, canonicalId: string): Promise<void>
  deleteMoodChannel(channelId: string): Promise<void>
}

export interface ISettingsService {
  listFlags(): Promise<FeatureFlag[]>
  setFlag(key: string, enabled: boolean): Promise<void>
  getFlag(key: string): Promise<boolean>
  refreshFlagCache(): Promise<void>
  isEnabled(key: string): boolean
  youtubeSetCookies(path: string): Promise<void>
  youtubeGetCookies(): Promise<string | null>
  youtubeClearCookies(): Promise<void>
  youtubeGetPlaylist(url: string): Promise<any[]>
  scanDirectory(path: string): Promise<import('../lib/tauri-ipc').TrackMeta[]>
  readMetadata(path: string): Promise<import('../lib/tauri-ipc').TrackMeta>
}
```

- [ ] **Commit**

```bash
git add src/services/interfaces.ts
git commit -m "feat: add service interfaces — typed contracts for all domains"
```

---

## Task 5: PlaylistService

**Files:**
- Create: `src/services/PlaylistService.ts`
- Create: `src/services/PlaylistService.test.ts`

- [ ] **Write failing test**

```ts
// src/services/PlaylistService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { PlaylistService } from './PlaylistService'
import { MockTransport } from './transport'
import type { Playlist, PlaylistTrack } from './interfaces'

const fakePlaylist: Playlist = { id: '1', name: 'Test', created_at: 0, updated_at: 0, track_count: 0 }
const fakeTrack: PlaylistTrack = {
  id: 't1', position: 0, title: 'Song', artist: 'Artist', duration: 180,
  source: 'local', source_id: '/a.mp3', album: '', original_title: '',
  original_artist: '', cover: '', genre: '',
}

describe('PlaylistService', () => {
  let transport: MockTransport
  let svc: PlaylistService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new PlaylistService(transport)
  })

  it('create calls create_playlist', async () => {
    transport.setResponse('create_playlist', fakePlaylist)
    const result = await svc.create('Test')
    expect(transport.lastCall).toEqual({ command: 'create_playlist', args: { name: 'Test' } })
    expect(result).toEqual(fakePlaylist)
  })

  it('list calls list_playlists', async () => {
    transport.setResponse('list_playlists', [fakePlaylist])
    const result = await svc.list()
    expect(transport.lastCall.command).toBe('list_playlists')
    expect(result).toHaveLength(1)
  })

  it('getTracks calls get_playlist_tracks', async () => {
    transport.setResponse('get_playlist_tracks', [fakeTrack])
    await svc.getTracks('1')
    expect(transport.lastCall).toEqual({ command: 'get_playlist_tracks', args: { playlistId: '1' } })
  })

  it('delete calls delete_playlist', async () => {
    transport.setResponse('delete_playlist', undefined)
    await svc.delete('1')
    expect(transport.lastCall).toEqual({ command: 'delete_playlist', args: { playlistId: '1' } })
  })

  it('saveSession calls save_session', async () => {
    transport.setResponse('save_session', undefined)
    await svc.saveSession([])
    expect(transport.lastCall.command).toBe('save_session')
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/services/PlaylistService.test.ts
```

- [ ] **Implement PlaylistService**

```ts
// src/services/PlaylistService.ts
import type { ITransport } from './transport'
import type { IPlaylistService, Playlist, PlaylistTrack, TrackInput } from './interfaces'

export class PlaylistService implements IPlaylistService {
  constructor(private t: ITransport) {}

  create(name: string) { return this.t.call<Playlist>('create_playlist', { name }) }
  list() { return this.t.call<Playlist[]>('list_playlists') }
  getTracks(playlistId: string) { return this.t.call<PlaylistTrack[]>('get_playlist_tracks', { playlistId }) }
  addTrack(playlistId: string, track: TrackInput) { return this.t.call<PlaylistTrack>('add_track_to_playlist', { playlistId, track }) }
  removeTrack(trackId: string) { return this.t.call<void>('remove_track_from_playlist', { trackId }) }
  delete(playlistId: string) { return this.t.call<void>('delete_playlist', { playlistId }) }
  saveSession(tracks: TrackInput[]) { return this.t.call<void>('save_session', { tracks }) }
  loadSession() { return this.t.call<PlaylistTrack[]>('load_session') }
  renameTrack(trackId: string, title?: string, artist?: string) {
    return this.t.call<void>('rename_track', { trackId, title: title ?? null, artist: artist ?? null })
  }
  updateTrackSource(trackId: string, source: string, sourceId: string) {
    return this.t.call<void>('update_track_source', { trackId, source, sourceId })
  }
  listGenres() { return this.t.call<string[]>('list_genres') }
  getTracksByGenre(genre: string) { return this.t.call<PlaylistTrack[]>('get_tracks_by_genre', { genre }) }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/services/PlaylistService.test.ts
```

- [ ] **Commit**

```bash
git add src/services/PlaylistService.ts src/services/PlaylistService.test.ts
git commit -m "feat: add PlaylistService with ITransport"
```

---

## Task 6: ScrobbleService

**Files:**
- Create: `src/services/ScrobbleService.ts`
- Create: `src/services/ScrobbleService.test.ts`

- [ ] **Write failing test**

```ts
// src/services/ScrobbleService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ScrobbleService } from './ScrobbleService'
import { MockTransport } from './transport'

describe('ScrobbleService', () => {
  let transport: MockTransport
  let svc: ScrobbleService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new ScrobbleService(transport)
  })

  it('lastfmNowPlaying sends correct command', async () => {
    transport.setResponse('lastfm_now_playing', undefined)
    await svc.lastfmNowPlaying('Artist', 'Title', 200)
    expect(transport.lastCall).toEqual({
      command: 'lastfm_now_playing',
      args: { artist: 'Artist', title: 'Title', duration: 200 },
    })
  })

  it('lastfmNowPlaying sends null duration when omitted', async () => {
    transport.setResponse('lastfm_now_playing', undefined)
    await svc.lastfmNowPlaying('A', 'B')
    expect(transport.lastCall.args!.duration).toBeNull()
  })

  it('lastfmScrobble sends correct command', async () => {
    transport.setResponse('lastfm_scrobble', undefined)
    await svc.lastfmScrobble('Artist', 'Title', 1000, 200)
    expect(transport.lastCall).toEqual({
      command: 'lastfm_scrobble',
      args: { artist: 'Artist', title: 'Title', timestamp: 1000, duration: 200 },
    })
  })

  it('lastfmGetStatus returns status', async () => {
    transport.setResponse('lastfm_get_status', 'testuser')
    const result = await svc.lastfmGetStatus()
    expect(result).toBe('testuser')
  })

  it('flushQueue calls scrobble_flush_queue', async () => {
    transport.setResponse('scrobble_flush_queue', 3)
    const result = await svc.flushQueue()
    expect(result).toBe(3)
    expect(transport.lastCall.command).toBe('scrobble_flush_queue')
  })

  it('listenbrainzNowPlaying sends correct command', async () => {
    transport.setResponse('listenbrainz_now_playing', undefined)
    await svc.listenbrainzNowPlaying('Artist', 'Title')
    expect(transport.lastCall).toEqual({
      command: 'listenbrainz_now_playing',
      args: { artist: 'Artist', title: 'Title' },
    })
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/services/ScrobbleService.test.ts
```

- [ ] **Implement ScrobbleService**

```ts
// src/services/ScrobbleService.ts
import type { ITransport } from './transport'
import type { IScrobbleService, ScrobbleStatus } from './interfaces'

export class ScrobbleService implements IScrobbleService {
  constructor(private t: ITransport) {}

  lastfmSaveSettings(apiKey: string, secret: string) {
    return this.t.call<void>('lastfm_save_settings', { apiKey, secret })
  }
  lastfmGetAuthUrl() { return this.t.call<string>('lastfm_get_auth_url') }
  lastfmAuth(token: string) { return this.t.call<{ name: string; key: string }>('lastfm_auth', { token }) }
  lastfmGetStatus() { return this.t.call<string | null>('lastfm_get_status') }
  lastfmNowPlaying(artist: string, title: string, duration?: number) {
    return this.t.call<void>('lastfm_now_playing', { artist, title, duration: duration ?? null })
  }
  lastfmScrobble(artist: string, title: string, timestamp: number, duration?: number) {
    return this.t.call<void>('lastfm_scrobble', { artist, title, timestamp, duration: duration ?? null })
  }
  listenbrainzSaveToken(token: string) { return this.t.call<string>('listenbrainz_save_token', { token }) }
  listenbrainzGetStatus() { return this.t.call<string | null>('listenbrainz_get_status') }
  listenbrainzLogout() { return this.t.call<void>('listenbrainz_logout') }
  listenbrainzNowPlaying(artist: string, title: string) {
    return this.t.call<void>('listenbrainz_now_playing', { artist, title })
  }
  listenbrainzScrobble(artist: string, title: string, timestamp: number, duration?: number) {
    return this.t.call<void>('listenbrainz_scrobble', { artist, title, timestamp, duration: duration ?? null })
  }
  getStatus() { return this.t.call<ScrobbleStatus>('scrobble_get_status') }
  flushQueue() { return this.t.call<number>('scrobble_flush_queue') }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/services/ScrobbleService.test.ts
```

- [ ] **Commit**

```bash
git add src/services/ScrobbleService.ts src/services/ScrobbleService.test.ts
git commit -m "feat: add ScrobbleService with ITransport — replaces scrobble-service.ts"
```

---

## Task 7: HistoryService

**Files:**
- Create: `src/services/HistoryService.ts`
- Create: `src/services/HistoryService.test.ts`

- [ ] **Write failing test**

```ts
// src/services/HistoryService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { HistoryService } from './HistoryService'
import { MockTransport } from './transport'
import type { ListenStats, Survey } from './interfaces'

describe('HistoryService', () => {
  let transport: MockTransport
  let svc: HistoryService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new HistoryService(transport)
  })

  it('resolveTrackId calls resolve_track_id', async () => {
    transport.setResponse('resolve_track_id', 'cid-123')
    const result = await svc.resolveTrackId('local', '/a.mp3', 'A', 'B', 200)
    expect(result).toBe('cid-123')
    expect(transport.lastCall.command).toBe('resolve_track_id')
  })

  it('recordListen calls record_track_listen', async () => {
    transport.setResponse('record_track_listen', undefined)
    await svc.recordListen('cid', 'local', 1000, 200, 150, true, false)
    expect(transport.lastCall.command).toBe('record_track_listen')
  })

  it('setLike calls set_track_like', async () => {
    transport.setResponse('set_track_like', undefined)
    await svc.setLike('cid', true)
    expect(transport.lastCall).toEqual({ command: 'set_track_like', args: { canonicalId: 'cid', liked: true } })
  })

  it('surveyGetPending returns null when none', async () => {
    transport.setResponse('survey_get_pending', null)
    const result = await svc.surveyGetPending()
    expect(result).toBeNull()
  })

  it('surveyRespond calls survey_respond', async () => {
    transport.setResponse('survey_respond', undefined)
    await svc.surveyRespond(1, 'like')
    expect(transport.lastCall).toEqual({ command: 'survey_respond', args: { surveyId: 1, response: 'like' } })
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/services/HistoryService.test.ts
```

- [ ] **Implement HistoryService**

```ts
// src/services/HistoryService.ts
import type { ITransport } from './transport'
import type { IHistoryService, ListenStats, Survey } from './interfaces'

export class HistoryService implements IHistoryService {
  constructor(private t: ITransport) {}

  resolveTrackId(source: string, sourceId: string, artist: string, title: string, duration: number) {
    return this.t.call<string>('resolve_track_id', { source, sourceId, artist, title, duration })
  }
  recordListen(canonicalId: string, source: string, startedAt: number, durationSecs: number, listenedSecs: number, completed: boolean, skippedEarly: boolean) {
    return this.t.call<void>('record_track_listen', { canonicalId, source, startedAt, durationSecs, listenedSecs, completed, skippedEarly })
  }
  setLike(canonicalId: string, liked: boolean) { return this.t.call<void>('set_track_like', { canonicalId, liked }) }
  removeLike(canonicalId: string) { return this.t.call<void>('remove_track_like', { canonicalId }) }
  getStats(canonicalId: string) { return this.t.call<ListenStats>('get_track_stats', { canonicalId }) }
  getLikedTracks() { return this.t.call<string[]>('get_liked_tracks') }
  surveyGetPending() { return this.t.call<Survey | null>('survey_get_pending') }
  surveyRespond(surveyId: number, response: string) { return this.t.call<void>('survey_respond', { surveyId, response }) }
  surveySkip(surveyId: number) { return this.t.call<void>('survey_skip', { surveyId }) }
  surveyMarkShown(surveyId: number) { return this.t.call<void>('survey_mark_shown', { surveyId }) }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/services/HistoryService.test.ts
```

- [ ] **Commit**

```bash
git add src/services/HistoryService.ts src/services/HistoryService.test.ts
git commit -m "feat: add HistoryService with ITransport"
```

---

## Task 8: RadioService

**Files:**
- Create: `src/services/RadioService.ts`
- Create: `src/services/RadioService.test.ts`

- [ ] **Write failing test**

```ts
// src/services/RadioService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { RadioService } from './RadioService'
import { MockTransport } from './transport'
import type { RadioStation } from './interfaces'

const fakeStation: RadioStation = {
  stationuuid: 'uuid-1', name: 'Test FM', url: 'http://stream', url_resolved: 'http://stream',
  homepage: '', favicon: '', tags: 'jazz', country: 'RU', countrycode: 'RU',
  language: 'ru', codec: 'MP3', bitrate: 128, votes: 100, clickcount: 50,
}

describe('RadioService', () => {
  let transport: MockTransport
  let svc: RadioService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new RadioService(transport)
  })

  it('search calls radio_search', async () => {
    transport.setResponse('radio_search', [fakeStation])
    await svc.search('jazz', 'jazz', 'RU', 10)
    expect(transport.lastCall).toEqual({
      command: 'radio_search',
      args: { query: 'jazz', tag: 'jazz', country: 'RU', limit: 10 },
    })
  })

  it('search passes null for optional args when omitted', async () => {
    transport.setResponse('radio_search', [])
    await svc.search('rock')
    expect(transport.lastCall.args).toEqual({ query: 'rock', tag: null, country: null, limit: null })
  })

  it('play calls radio_play with JSON station', async () => {
    transport.setResponse('radio_play', 'http://stream')
    await svc.play(fakeStation)
    expect(transport.lastCall.command).toBe('radio_play')
    expect(transport.lastCall.args!.stationJson).toBe(JSON.stringify(fakeStation))
  })

  it('addFavorite calls radio_add_favorite with JSON station', async () => {
    transport.setResponse('radio_add_favorite', undefined)
    await svc.addFavorite(fakeStation)
    expect(transport.lastCall.args!.stationJson).toBe(JSON.stringify(fakeStation))
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/services/RadioService.test.ts
```

- [ ] **Implement RadioService**

```ts
// src/services/RadioService.ts
import type { ITransport } from './transport'
import type { IRadioService, RadioStation, RadioTag, RadioNowPlaying, CachedSegment } from './interfaces'

export class RadioService implements IRadioService {
  constructor(private t: ITransport) {}

  search(query: string, tag?: string, country?: string, limit?: number) {
    return this.t.call<RadioStation[]>('radio_search', { query, tag: tag ?? null, country: country ?? null, limit: limit ?? null })
  }
  topStations(limit?: number) { return this.t.call<RadioStation[]>('radio_top_stations', { limit: limit ?? null }) }
  byTag(tag: string, limit?: number) { return this.t.call<RadioStation[]>('radio_by_tag', { tag, limit: limit ?? null }) }
  tags() { return this.t.call<RadioTag[]>('radio_tags') }
  addFavorite(station: RadioStation) { return this.t.call<void>('radio_add_favorite', { stationJson: JSON.stringify(station) }) }
  removeFavorite(stationuuid: string) { return this.t.call<void>('radio_remove_favorite', { stationuuid }) }
  listFavorites() { return this.t.call<RadioStation[]>('radio_list_favorites') }
  addCustom(name: string, url: string, tags?: string) { return this.t.call<void>('radio_add_custom', { name, url, tags: tags ?? null }) }
  removeCustom(id: string) { return this.t.call<void>('radio_remove_custom', { id }) }
  listCustom() { return this.t.call<RadioStation[]>('radio_list_custom') }
  play(station: RadioStation) { return this.t.call<string>('radio_play', { stationJson: JSON.stringify(station) }) }
  stop() { return this.t.call<void>('radio_stop') }
  nowPlaying() { return this.t.call<RadioNowPlaying | null>('radio_now_playing') }
  listCached() { return this.t.call<CachedSegment[]>('radio_list_cached') }
  saveSegment(index: number, title?: string) { return this.t.call<string>('radio_save_segment', { index, title: title ?? null }) }
  saveLastSecs(secs: number, title?: string) { return this.t.call<string>('radio_save_last_secs', { secs, title: title ?? null }) }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/services/RadioService.test.ts
```

- [ ] **Commit**

```bash
git add src/services/RadioService.ts src/services/RadioService.test.ts
git commit -m "feat: add RadioService with ITransport"
```

---

## Task 9: RecommendationService

**Files:**
- Create: `src/services/RecommendationService.ts`
- Create: `src/services/RecommendationService.test.ts`

- [ ] **Write failing test**

```ts
// src/services/RecommendationService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { RecommendationService } from './RecommendationService'
import { MockTransport } from './transport'
import type { MoodChannel, Recommendation } from './interfaces'

describe('RecommendationService', () => {
  let transport: MockTransport
  let svc: RecommendationService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new RecommendationService(transport)
  })

  it('getRecommendations maps tuples to Recommendation objects', async () => {
    transport.setResponse('get_hybrid_recommendations', [
      ['cid1', 0.9, 'local', 'Artist', 'Title'],
    ])
    const result = await svc.getRecommendations(10)
    expect(result).toEqual([{ canonicalId: 'cid1', score: 0.9, source: 'local', artist: 'Artist', title: 'Title' }])
    expect(transport.lastCall).toEqual({ command: 'get_hybrid_recommendations', args: { limit: 10 } })
  })

  it('getRecommendations passes null when limit omitted', async () => {
    transport.setResponse('get_hybrid_recommendations', [])
    await svc.getRecommendations()
    expect(transport.lastCall.args).toEqual({ limit: null })
  })

  it('listMoodChannels calls list_mood_channels', async () => {
    transport.setResponse('list_mood_channels', [])
    await svc.listMoodChannels()
    expect(transport.lastCall.command).toBe('list_mood_channels')
  })

  it('syncProfile returns count', async () => {
    transport.setResponse('sync_profile', 5)
    const n = await svc.syncProfile()
    expect(n).toBe(5)
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/services/RecommendationService.test.ts
```

- [ ] **Implement RecommendationService**

```ts
// src/services/RecommendationService.ts
import type { ITransport } from './transport'
import type { IRecommendationService, Recommendation, MoodChannel } from './interfaces'

export class RecommendationService implements IRecommendationService {
  constructor(private t: ITransport) {}

  syncProfile() { return this.t.call<number>('sync_profile') }

  async getRecommendations(limit?: number): Promise<Recommendation[]> {
    const recs = await this.t.call<[string, number, string, string, string][]>(
      'get_hybrid_recommendations', { limit: limit ?? null }
    )
    return recs.map(([canonicalId, score, source, artist, title]) => ({ canonicalId, score, source, artist, title }))
  }

  getColdstart(artist: string, title: string, limit?: number) {
    return this.t.call<[string, string, number][]>('get_coldstart_recommendations', { artist, title, limit: limit ?? null })
  }
  listMoodChannels() { return this.t.call<MoodChannel[]>('list_mood_channels') }
  createMoodChannel(name: string, description: string) { return this.t.call<MoodChannel>('create_mood_channel', { name, description }) }
  addSeedTrack(channelId: string, canonicalId: string) { return this.t.call<void>('add_seed_track', { channelId, canonicalId }) }
  deleteMoodChannel(channelId: string) { return this.t.call<void>('delete_mood_channel', { channelId }) }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/services/RecommendationService.test.ts
```

- [ ] **Commit**

```bash
git add src/services/RecommendationService.ts src/services/RecommendationService.test.ts
git commit -m "feat: add RecommendationService with ITransport"
```

---

## Task 10: SettingsService

**Files:**
- Create: `src/services/SettingsService.ts`
- Create: `src/services/SettingsService.test.ts`

- [ ] **Write failing test**

```ts
// src/services/SettingsService.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SettingsService } from './SettingsService'
import { MockTransport } from './transport'
import type { FeatureFlag } from './interfaces'

const flags: FeatureFlag[] = [
  { key: 'recommendations', enabled: true, description: 'Enable recs' },
  { key: 'auto_scrobble', enabled: false, description: 'Auto scrobble' },
]

describe('SettingsService', () => {
  let transport: MockTransport
  let svc: SettingsService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new SettingsService(transport)
  })

  it('refreshFlagCache + isEnabled works', async () => {
    transport.setResponse('feature_flags_list', flags)
    await svc.refreshFlagCache()
    expect(svc.isEnabled('recommendations')).toBe(true)
    expect(svc.isEnabled('auto_scrobble')).toBe(false)
  })

  it('isEnabled returns true for unknown key (default)', () => {
    expect(svc.isEnabled('unknown_key')).toBe(true)
  })

  it('setFlag calls feature_flags_set', async () => {
    transport.setResponse('feature_flags_set', undefined)
    await svc.setFlag('auto_scrobble', true)
    expect(transport.lastCall).toEqual({ command: 'feature_flags_set', args: { key: 'auto_scrobble', enabled: true } })
  })

  it('youtubeSetCookies calls youtube_set_cookies', async () => {
    transport.setResponse('youtube_set_cookies', undefined)
    await svc.youtubeSetCookies('/path/cookies.txt')
    expect(transport.lastCall).toEqual({ command: 'youtube_set_cookies', args: { path: '/path/cookies.txt' } })
  })
})
```

- [ ] **Run to confirm FAIL**

```
pnpm test src/services/SettingsService.test.ts
```

- [ ] **Implement SettingsService**

```ts
// src/services/SettingsService.ts
import type { ITransport } from './transport'
import type { ISettingsService, FeatureFlag } from './interfaces'
import type { TrackMeta } from '../lib/tauri-ipc'

export class SettingsService implements ISettingsService {
  private cache = new Map<string, boolean>()

  constructor(private t: ITransport) {}

  listFlags() { return this.t.call<FeatureFlag[]>('feature_flags_list') }
  setFlag(key: string, enabled: boolean) { return this.t.call<void>('feature_flags_set', { key, enabled }) }
  getFlag(key: string) { return this.t.call<boolean>('feature_flag_get', { key }) }

  async refreshFlagCache(): Promise<void> {
    const flags = await this.listFlags()
    this.cache.clear()
    for (const f of flags) this.cache.set(f.key, f.enabled)
  }

  isEnabled(key: string): boolean {
    return this.cache.get(key) ?? true
  }

  youtubeSetCookies(path: string) { return this.t.call<void>('youtube_set_cookies', { path }) }
  youtubeGetCookies() { return this.t.call<string | null>('youtube_get_cookies') }
  youtubeClearCookies() { return this.t.call<void>('youtube_clear_cookies') }
  youtubeGetPlaylist(url: string) { return this.t.call<any[]>('youtube_get_playlist', { url }) }
  scanDirectory(path: string) { return this.t.call<TrackMeta[]>('scan_directory', { path }) }
  readMetadata(path: string) { return this.t.call<TrackMeta>('read_metadata', { path }) }
}
```

- [ ] **Run to confirm PASS**

```
pnpm test src/services/SettingsService.test.ts
```

- [ ] **Commit**

```bash
git add src/services/SettingsService.ts src/services/SettingsService.test.ts
git commit -m "feat: add SettingsService with ITransport — replaces feature-flags-service.ts"
```

---

## Task 11: Service Registry

**Files:**
- Create: `src/services/index.ts`

No tests — pure wiring.

- [ ] **Write services/index.ts**

```ts
// src/services/index.ts
import { TauriTransport } from './transport'
import { PlaylistService } from './PlaylistService'
import { ScrobbleService } from './ScrobbleService'
import { HistoryService } from './HistoryService'
import { RadioService } from './RadioService'
import { RecommendationService } from './RecommendationService'
import { SettingsService } from './SettingsService'

const transport = new TauriTransport()

export const playlists = new PlaylistService(transport)
export const scrobble = new ScrobbleService(transport)
export const history = new HistoryService(transport)
export const radio = new RadioService(transport)
export const recommendations = new RecommendationService(transport)
export const settings = new SettingsService(transport)
```

- [ ] **Commit**

```bash
git add src/services/index.ts
git commit -m "feat: add service registry — single TauriTransport instance shared across services"
```

---

## Task 12: Session Bootstrap

**Files:**
- Create: `src/bootstrap/session.ts`

- [ ] **Write session.ts** (extracted and cleaned from bridge.ts `setupSessionRestore` + `saveCurrentSession`)

```ts
// src/bootstrap/session.ts
import { convertFileSrc } from '@tauri-apps/api/core'
import type { PlayerStore } from '../player/PlayerStore'
import type { IPlaylistService, PlaylistTrack, TrackInput } from '../services/interfaces'

async function resolvePlaylistTracks(
  tracks: { source: string; source_id: string; artist: string; title: string; duration: number }[],
) {
  return tracks
    .map((t) => ({
      metaData: { artist: t.artist || 'Unknown Artist', title: t.title || 'Unknown Track' },
      url: t.source_id.startsWith('http') ? t.source_id : convertFileSrc(t.source_id),
      duration: t.duration,
    }))
    .filter((t) => t.url)
}

export async function saveSession(store: PlayerStore, playlists: IPlaylistService): Promise<void> {
  const tracks = store.getTracks()
  if (tracks.length === 0) return

  const inputs: TrackInput[] = tracks.map((t) => {
    const isYoutube = (t.url || '').includes('audio_cache')
    return {
      title: t.title || t.defaultName || 'Unknown',
      artist: t.artist || '',
      duration: t.duration || 0,
      source: isYoutube ? 'youtube' : 'local',
      source_id: t.url || '',
    }
  })
  await playlists.saveSession(inputs)
}

export async function restoreSession(
  setTracksToPlay: (tracks: any[]) => void,
  dispatchStop: () => void,
  playlists: IPlaylistService,
): Promise<void> {
  const lastPlaylistId = localStorage.getItem('goamp_last_playlist_id')
  if (lastPlaylistId) {
    const tracks = await playlists.getTracks(lastPlaylistId)
    if (tracks.length > 0) {
      const valid = await resolvePlaylistTracks(tracks)
      if (valid.length > 0) {
        setTracksToPlay(valid)
        dispatchStop()
        return
      }
    }
  }

  const tracks = await playlists.loadSession()
  if (tracks.length === 0) return
  const valid = await resolvePlaylistTracks(tracks)
  if (valid.length === 0) return
  setTracksToPlay(valid)
  dispatchStop()
}
```

- [ ] **Commit**

```bash
git add src/bootstrap/session.ts
git commit -m "feat: extract session.ts from bridge.ts"
```

---

## Task 13: Keyboard Bootstrap

**Files:**
- Create: `src/bootstrap/keyboard.ts`

- [ ] **Write keyboard.ts** (extracted from bridge.ts `setupKeyboard`)

```ts
// src/bootstrap/keyboard.ts
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { track, trackError } from '../lib/analytics'
import { toWebampTracks } from '../webamp/tracks'
import { toggleSearchOverlay } from '../youtube/SearchOverlay'
import { togglePlaylistPanel } from '../playlists/PlaylistPanel'
import { toggleAudioDevicePanel } from '../settings/AudioDevicePanel'
import { toggleScrobbleSettings } from '../scrobble/ScrobbleSettings'
import { toggleFeatureFlagsPanel } from '../settings/FeatureFlagsPanel'
import { toggleVisualizerPanel } from '../webamp/VisualizerPanel'
import { toggleGenrePanel, toggleYouTubeSettings } from '../settings/GenrePanel'
import { toggleRadioPanel } from '../radio/RadioPanel'
import { toggleRecommendationPanel } from '../recommendations/RecommendationPanel'
import type { PlayerStore } from '../player/PlayerStore'
import type { ISettingsService } from '../services/interfaces'

export function setupKeyboard(store: PlayerStore, settings: ISettingsService, openFolder: () => Promise<void>, openFiles: () => Promise<void>, loadSkin: () => Promise<void>): void {
  document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyO') {
      e.preventDefault()
      await openFolder()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyO') {
      e.preventDefault()
      await openFiles()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyY') {
      e.preventDefault()
      toggleSearchOverlay()
    }
    const active = document.activeElement
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyP') {
      e.preventDefault()
      togglePlaylistPanel()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyS') {
      e.preventDefault()
      await loadSkin()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyD') {
      e.preventDefault()
      toggleAudioDevicePanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyL') {
      e.preventDefault()
      toggleScrobbleSettings()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyG') {
      e.preventDefault()
      toggleGenrePanel()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyR') {
      e.preventDefault()
      toggleRadioPanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyR') {
      e.preventDefault()
      toggleRecommendationPanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyY') {
      e.preventDefault()
      toggleYouTubeSettings()
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyV') {
      e.preventDefault()
      const appWindow = getCurrentWindow()
      if (store.isMilkdropOpen()) {
        store.dispatch({ type: 'CLOSE_MILKDROP_WINDOW' })
        appWindow.setSize(new LogicalSize(275, 464)).catch(() => {})
      } else {
        store.dispatch({ type: 'OPEN_MILKDROP_WINDOW' })
        appWindow.setSize(new LogicalSize(800, 464)).catch(() => {})
        setTimeout(() => {
          store.dispatch({ type: 'UPDATE_WINDOW_POSITIONS', positions: { milkdrop: { x: 275, y: 0 } }, absolute: true })
        }, 50)
      }
    }
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyV' && !isTyping) {
      toggleVisualizerPanel()
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Backquote') {
      e.preventDefault()
      toggleFeatureFlagsPanel()
    }
  })
}
```

- [ ] **Commit**

```bash
git add src/bootstrap/keyboard.ts
git commit -m "feat: extract keyboard.ts from bridge.ts"
```

---

## Task 14: AppBootstrap

**Files:**
- Create: `src/bootstrap/AppBootstrap.ts`

- [ ] **Write AppBootstrap.ts** (thin wiring that replaces bridge.ts)

```ts
// src/bootstrap/AppBootstrap.ts
import { open } from '@tauri-apps/plugin-dialog'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { track, trackError } from '../lib/analytics'
import { toWebampTracks } from '../webamp/tracks'
import { setupWindowDrag, setupClickThrough } from '../webamp/window-drag'
import { initSearchOverlay } from '../youtube/SearchOverlay'
import { initPlaylistPanel } from '../playlists/PlaylistPanel'
import { initAudioDevicePanel, restoreAudioDevice } from '../settings/AudioDevicePanel'
import { initScrobbleSettings } from '../scrobble/ScrobbleSettings'
import { initGoampMenu } from '../webamp/goamp-menu'
import { initVisualizerPanel } from '../webamp/VisualizerPanel'
import { initGenrePanel } from '../settings/GenrePanel'
import { initRadioPanel } from '../radio/RadioPanel'
import { initRecommendationPanel } from '../recommendations/RecommendationPanel'
import { checkForUpdates } from '../updater/UpdateNotification'
import { HistoryTracker } from '../recommendations/history-service'
import { PlayerStore } from '../player/PlayerStore'
import { PlayerEvents } from '../player/PlayerEvents'
import { saveSession, restoreSession } from './session'
import { setupKeyboard } from './keyboard'
import { settings, playlists, scrobble, history } from '../services/index'
import type Webamp from 'webamp'

export async function setupApp(webamp: Webamp): Promise<void> {
  const store = new PlayerStore(webamp)
  const events = new PlayerEvents(store)
  const appWindow = getCurrentWindow()

  appWindow.setAlwaysOnTop(false).catch(() => {})

  // Init panels
  initSearchOverlay(webamp)
  initPlaylistPanel(webamp)
  initAudioDevicePanel(webamp)
  initScrobbleSettings()
  initVisualizerPanel(webamp)
  initGenrePanel(webamp)
  initRadioPanel(webamp)
  initRecommendationPanel(webamp)
  initGoampMenu(webamp)
  restoreAudioDevice()
  settings.refreshFlagCache().catch(() => {})

  // Session
  await restoreSession(
    (tracks) => webamp.setTracksToPlay(tracks),
    () => store.dispatch({ type: 'STOP' }),
    playlists,
  ).catch((e) => console.error('[GOAMP] Failed to restore session:', e))

  // Close handler
  const handleClose = async () => {
    try { await saveSession(store, playlists) } catch (e) { console.error('[GOAMP] Failed to save session:', e) }
    appWindow.destroy()
  }
  webamp.onWillClose(handleClose)
  webamp.onClose(handleClose)

  // Track analytics
  events.onTrackChange((trackInfo) => {
    if (!trackInfo) return
    const url = trackInfo.url || ''
    const source = url.startsWith('http') ? 'youtube' : 'local'
    const ext = url.split('.').pop()?.toLowerCase() || 'unknown'
    track('track_played', { source, format: source === 'local' ? ext : 'stream' })
    const meta = (trackInfo as any).metaData
    const artist = (meta?.artist || 'Unknown').slice(0, 100)
    const title = (meta?.title || 'Unknown').slice(0, 100)
    if (meta?.artist || meta?.title) track('track_info', { artist, title, source })
    const tooltip = `${artist} — ${title}`
    invoke('update_tray_tooltip', { text: tooltip }).catch(() => {})
    invoke('update_media_metadata', { title, artist }).catch(() => {})
    invoke('update_media_playback', { playing: true }).catch(() => {})
  })

  // Media keys
  const webview = getCurrentWebviewWindow()
  webview.listen<string>('media-action', ({ payload }) => {
    switch (payload) {
      case 'play':
      case 'play_pause': {
        const status = store.getStatus()
        if (status === 'PLAYING') {
          store.dispatch({ type: 'PAUSE' })
          invoke('update_media_playback', { playing: false }).catch(() => {})
        } else {
          store.dispatch({ type: 'PLAY' })
          invoke('update_media_playback', { playing: true }).catch(() => {})
        }
        break
      }
      case 'pause':
        store.dispatch({ type: 'PAUSE' })
        invoke('update_media_playback', { playing: false }).catch(() => {})
        break
      case 'next': store.dispatch({ type: 'PLAY_TRACK', id: 'NEXT' }); break
      case 'prev': store.dispatch({ type: 'PLAY_TRACK', id: 'PREV' }); break
      case 'stop':
        store.dispatch({ type: 'STOP' })
        invoke('update_media_playback', { playing: false }).catch(() => {})
        break
      case 'quit': saveSession(store, playlists).catch(() => {}); break
    }
  })

  // Scrobbling
  let scrobbleTimer: ReturnType<typeof setInterval> | null = null
  let currentTrackStart = 0
  let currentTrackDuration = 0
  let currentTrackScrobbled = false
  let currentTrackArtist = ''
  let currentTrackTitle = ''

  const flushInterval = setInterval(() => { scrobble.flushQueue().catch(() => {}) }, 30000)

  events.onTrackChange(async (trackInfo) => {
    if (scrobbleTimer) clearInterval(scrobbleTimer)
    currentTrackScrobbled = false
    currentTrackStart = Math.floor(Date.now() / 1000)
    if (!trackInfo) return

    const meta = (trackInfo as any).metaData
    currentTrackArtist = meta?.artist || ''
    currentTrackTitle = meta?.title || trackInfo.url?.split('/').pop() || ''
    currentTrackDuration = (trackInfo as any).duration || 0
    if (!currentTrackArtist && !currentTrackTitle) return

    if (!settings.isEnabled('auto_scrobble')) return
    const lastfmEnabled = localStorage.getItem('goamp_lastfm_enabled') === '1' && settings.isEnabled('lastfm_scrobble')
    const lbEnabled = localStorage.getItem('goamp_lb_enabled') === '1' && settings.isEnabled('listenbrainz_scrobble')
    if (!lastfmEnabled && !lbEnabled) return

    let hasLastfm = false, hasLb = false
    if (lastfmEnabled) { try { hasLastfm = !!(await scrobble.lastfmGetStatus()) } catch {} }
    if (lbEnabled) { try { hasLb = !!(await scrobble.listenbrainzGetStatus()) } catch {} }
    if (!hasLastfm && !hasLb) return

    const artist = currentTrackArtist || 'Unknown'
    const dur = currentTrackDuration > 0 ? Math.floor(currentTrackDuration) : undefined
    if (hasLastfm) scrobble.lastfmNowPlaying(artist, currentTrackTitle, dur).catch(() => {})
    if (hasLb) scrobble.listenbrainzNowPlaying(artist, currentTrackTitle).catch(() => {})

    scrobbleTimer = setInterval(() => {
      if (currentTrackScrobbled) { if (scrobbleTimer) clearInterval(scrobbleTimer); return }
      if (store.getStatus() !== 'PLAYING') return
      const elapsed = Math.floor(Date.now() / 1000) - currentTrackStart
      const threshold = Math.min(currentTrackDuration > 0 ? currentTrackDuration / 2 : Infinity, 240)
      if (elapsed >= threshold) {
        currentTrackScrobbled = true
        if (scrobbleTimer) clearInterval(scrobbleTimer)
        const sd = currentTrackDuration > 0 ? Math.floor(currentTrackDuration) : undefined
        if (hasLastfm) scrobble.lastfmScrobble(artist, currentTrackTitle, currentTrackStart, sd).catch(() => {})
        if (hasLb) scrobble.listenbrainzScrobble(artist, currentTrackTitle, currentTrackStart, sd).catch(() => {})
      }
    }, 5000)
  })

  // History tracking
  if (settings.isEnabled('recommendations')) {
    function extractSource(url: string): { source: string; sourceId: string } {
      if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('audio_cache')) {
        const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/)
        return { source: 'youtube', sourceId: match?.[1] ?? url }
      }
      if (url.includes('soundcloud.com')) return { source: 'soundcloud', sourceId: url }
      return { source: 'local', sourceId: url }
    }

    const historyTracker = new HistoryTracker(
      (source, sourceId, artist, title, duration) => history.resolveTrackId(source, sourceId, artist, title, duration),
      (canonicalId, source, startedAt, durationSecs, listenedSecs, completed, skippedEarly) =>
        history.recordListen(canonicalId, source, startedAt, durationSecs, listenedSecs, completed, skippedEarly),
    )
    let tracking = false

    events.onTrackChange((trackInfo) => {
      if (tracking) {
        const listenedSecs = Math.floor(store.getTimeElapsed())
        historyTracker.onTrackEnd(listenedSecs).catch(() => {})
        tracking = false
      }
      if (!trackInfo) return
      const url = (trackInfo as any).url || ''
      const meta = (trackInfo as any).metaData
      const { source, sourceId } = extractSource(url)
      historyTracker.onTrackStart(source, sourceId, meta?.artist || '', meta?.title || '', (trackInfo as any).duration ?? 0)
      tracking = true
    })
  }

  // File open helpers for keyboard
  const openFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: 'Select music folder' })
    if (!selected) return
    const path = typeof selected === 'string' ? selected : selected[0]
    if (!path) return
    try {
      const tracks = await settings.scanDirectory(path)
      if (tracks.length === 0) return
      webamp.setTracksToPlay(toWebampTracks(tracks))
      track('folder_opened', { track_count: tracks.length })
    } catch (e) { trackError(e, { action: 'open_folder' }) }
  }

  const openFiles = async () => {
    const selected = await open({
      multiple: true, title: 'Select audio files',
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'ogg', 'wav', 'opus', 'm4a', 'aac'] }],
    })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    try {
      const metas = await Promise.all(paths.map((p) => settings.readMetadata(p)))
      webamp.setTracksToPlay(toWebampTracks(metas))
      track('files_opened', { track_count: metas.length })
    } catch (e) { trackError(e, { action: 'open_files' }) }
  }

  const loadSkin = async () => {
    const selected = await open({
      multiple: false, title: 'Select Winamp skin (.wsz)',
      filters: [{ name: 'Winamp Skin', extensions: ['wsz', 'zip'] }],
    })
    if (!selected) return
    const path = typeof selected === 'string' ? selected : selected[0]
    if (!path) return
    try { webamp.setSkinFromUrl(convertFileSrc(path)); track('skin_loaded') }
    catch (e) { trackError(e, { action: 'load_skin' }) }
  }

  setupKeyboard(store, settings, openFolder, openFiles, loadSkin)
  setupWindowDrag()
  setupClickThrough()

  setTimeout(() => checkForUpdates(), 5000)
}
```

- [ ] **Commit**

```bash
git add src/bootstrap/AppBootstrap.ts src/bootstrap/session.ts src/bootstrap/keyboard.ts
git commit -m "feat: add AppBootstrap — replaces bridge.ts with service-layer wiring"
```

---

## Task 15: Wire main.ts + Delete old files

**Files:**
- Modify: `src/main.ts`
- Delete: `src/webamp/bridge.ts`
- Delete: `src/scrobble/scrobble-service.ts` (replaced by ScrobbleService)
- Delete: `src/recommendations/recommendation-service.ts` (replaced by RecommendationService)

- [ ] **Update panels to use new services**

Any panel that imports directly from `src/scrobble/scrobble-service.ts` needs to import from `src/services/index.ts` instead. Search for these imports:

```bash
grep -r "from.*scrobble/scrobble-service" src/
grep -r "from.*recommendations/recommendation-service" src/
grep -r "from.*settings/feature-flags-service" src/
grep -r "from.*lib/tauri-ipc" src/
```

For each file found, replace the import with the appropriate service from `src/services/index.ts`. Example:

```ts
// Before (in ScrobbleSettings.ts)
import { lastfmSaveSettings, lastfmGetAuthUrl, lastfmAuth, lastfmGetStatus } from '../scrobble/scrobble-service'

// After
import { scrobble } from '../services/index'
// Then use: scrobble.lastfmSaveSettings(...), scrobble.lastfmGetAuthUrl(), etc.
```

```ts
// Before (in feature-flags-service users)
import { isFeatureEnabled, refreshFlagCache } from '../settings/feature-flags-service'

// After
import { settings } from '../services/index'
// Then use: settings.isEnabled(...), settings.refreshFlagCache()
```

- [ ] **Update main.ts**

```ts
// src/main.ts
import Webamp from 'webamp'
import { setupApp } from './bootstrap/AppBootstrap'
import { getButterchurnOptions } from './webamp/butterchurn'
import { initAnalytics, track } from './lib/analytics'

const webamp = new Webamp({
  __initialWindowLayout: {
    main: { position: { x: 0, y: 0 } },
    equalizer: { position: { x: 0, y: 116 } },
    playlist: { position: { x: 0, y: 232 }, size: [0, 4] },
  },
  initialTracks: [
    {
      metaData: { artist: 'GOAMP', title: 'Press Ctrl+O to open a folder' },
      url: '',
      duration: 0,
    },
  ],
  __butterchurnOptions: getButterchurnOptions(),
} as any)

const container = document.getElementById('app')!
initAnalytics()

webamp.renderWhenReady(container).then(() => {
  setupApp(webamp)
  track('app_launched')
})
```

- [ ] **Build to confirm no compile errors**

```
pnpm build
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Run all tests**

```
pnpm test
```
Expected: all tests pass.

- [ ] **Delete old files**

```bash
git rm src/webamp/bridge.ts
git rm src/scrobble/scrobble-service.ts
git rm src/recommendations/recommendation-service.ts
```

- [ ] **Final commit**

```bash
git add src/main.ts
git commit -m "feat: wire AppBootstrap in main.ts, remove bridge.ts and old service files"
```

---

## Self-Review

**Spec coverage:**
- ✅ PlayerStore — Task 1
- ✅ PlayerEvents — Task 2
- ✅ ITransport + TauriTransport + MockTransport — Task 3
- ✅ All service interfaces — Task 4
- ✅ PlaylistService — Task 5
- ✅ ScrobbleService — Task 6
- ✅ HistoryService — Task 7
- ✅ RadioService — Task 8
- ✅ RecommendationService — Task 9
- ✅ SettingsService — Task 10
- ✅ services/index.ts — Task 11
- ✅ session.ts — Task 12
- ✅ keyboard.ts — Task 13
- ✅ AppBootstrap — Task 14
- ✅ main.ts + cleanup — Task 15
- ✅ Frontend-only tests (no invoke/Tauri in tests) — enforced throughout
- ✅ No `(webamp as any)` outside PlayerStore — enforced by removing bridge.ts

**Type consistency:** All service methods in Tasks 5-10 match the interfaces defined in Task 4. `TrackInfo` defined in Task 1 used in Task 2. `IPlaylistService` used in Task 12 matches Task 4.

**Placeholders:** None.
