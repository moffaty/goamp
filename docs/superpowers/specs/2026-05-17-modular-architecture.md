# GOAMP Modular Architecture — Design Spec

**Date:** 2026-05-17  
**Status:** Accepted

---

## Philosophy

GOAMP is a **music player framework**, not a music player application.

The application is what you assemble from modules. Every major concern — UI rendering, music sources, features — is a module implementing a typed interface. The core knows nothing about Webamp, Spotify, or scrobbling. It only knows how to host modules, route events, and wire dependencies.

This means:
- Swap Webamp for a custom UI → replace one module
- Add Spotify → register one `ISource`
- Add libp2p sync → register one `IFeature`
- Ship GOAMP as an SDK → consumers compose their own assembly

---

## Layer Map

```
┌──────────────────────────────────────────────────────┐
│                    main.ts (assembly)                │
│   GoampCore().renderer(...).source(...).feature(...) │
└──────────────┬────────────────────────┬─────────────┘
               │                        │
    ┌──────────▼──────────┐   ┌────────▼────────────┐
    │     goamp-core      │   │      ITransport      │
    │  - ModuleHost       │   │  TauriTransport      │
    │  - EventBus         │   │  HttpTransport       │
    │  - KVStorage        │   │  MockTransport       │
    └──────────┬──────────┘   └─────────────────────-┘
               │ provides ModuleContext to all modules
    ┌──────────┴────────────────────────────────────┐
    │                                               │
    ▼              ▼                  ▼             ▼
IRenderer      ISource           IFeature      IScrobbler

WebampRenderer  LocalSource       RadioFeature   LastFMScrobbler
               SpotifySource     RecsFeature    ListenBrainzScrobbler
               YandexSource      P2PFeature
               YouTubeSource     HistoryFeature
                                 PlaylistFeature
```

---

## Core Interfaces

### Track (universal currency)

```typescript
// src/core/types.ts

export interface Track {
  id: string              // canonical ID (resolved by HistoryFeature)
  title: string
  artist: string
  album?: string
  duration?: number       // seconds
  cover?: string          // URL
  source: string          // 'local' | 'spotify' | 'yandex' | 'youtube' | ...
  sourceId: string        // opaque ID within the source
  streamUrl?: string      // resolved when ready to play
  // sources that need DRM don't fill streamUrl — they use IPlaybackProvider
}

export type PlaybackStatus = 'PLAYING' | 'PAUSED' | 'STOPPED'

export interface PlaybackState {
  status: PlaybackStatus
  track: Track | null
  timeElapsed: number     // seconds
  duration: number        // seconds
}
```

---

### IRenderer — UI is a module

```typescript
// src/core/IRenderer.ts

export interface IRenderer {
  readonly id: string   // 'webamp' | 'minimal' | ...

  // Lifecycle
  mount(container: HTMLElement, ctx: ModuleContext): Promise<void>
  destroy(): void

  // Core → Renderer: push state
  setTracks(tracks: Track[]): void
  setPlaybackState(state: PlaybackState): void

  // Renderer → Core: user intent callbacks (registered by core after mount)
  onUserPlay(cb: () => void): void
  onUserPause(cb: () => void): void
  onUserStop(cb: () => void): void
  onUserNext(cb: () => void): void
  onUserPrev(cb: () => void): void
  onUserSeek(cb: (seconds: number) => void): void
  onUserAddTracks(cb: (tracks: Track[]) => void): void
  onUserClose(cb: () => void): void
}
```

`WebampRenderer` wraps `PlayerStore` + `PlayerEvents` and adapts them to this contract. Core never imports Webamp directly.

---

### ISource — music source

```typescript
// src/core/ISource.ts

export interface SearchResult {
  track: Track
  previewUrl?: string
}

export interface ILibrary {
  getPlaylists(): Promise<Playlist[]>
  getPlaylistTracks(id: string): Promise<Track[]>
  getLikedTracks(): Promise<Track[]>
}

export interface ISource {
  readonly id: string   // 'local' | 'spotify' | 'yandex' | ...
  readonly name: string

  init(ctx: ModuleContext): Promise<void>
  destroy(): void

  // Resolve a streamUrl for a track before playback
  // Sources that control playback themselves (DRM) return null
  resolve(track: Track): Promise<string | null>

  // Optional capabilities
  search?(query: string): Promise<SearchResult[]>
  library?: ILibrary
}
```

**LocalSource** — resolves `file://` URLs via Tauri `convertFileSrc`.  
**SpotifySource** — returns `null` from `resolve()`, registers its own `IPlaybackProvider`.  
**YouTubeSource** — resolves to a cached audio URL via yt-dlp.

---

### IFeature — any cross-cutting concern

```typescript
// src/core/IFeature.ts

export interface IFeature {
  readonly id: string   // 'radio' | 'scrobble' | 'recommendations' | 'p2p' | ...

  init(ctx: ModuleContext): Promise<void>
  destroy(): void
}
```

Features are the most open-ended layer. They get `ModuleContext` and can:
- Subscribe to player events
- Register UI panels via `ctx.ui`
- Call their backend via `ctx.transport`
- Read/write their isolated storage via `ctx.storage`

**RadioFeature** → registers Radio panel, provides radio playback.  
**ScrobbleFeature** → listens to `track:change` events, scrobbles.  
**RecommendationsFeature** → listens to history, surfaces recs UI.  
**P2PFeature** → starts libp2p node, registers sync UI.  
**HistoryFeature** → records listens, exposes `resolve_track_id`.

---

### ModuleContext — what core provides to every module

```typescript
// src/core/ModuleContext.ts

export interface IUIRegistry {
  // Register a panel (side drawer, modal, etc.)
  registerPanel(id: string, render: () => HTMLElement): void
  // Register a keyboard shortcut
  registerShortcut(keys: string, handler: () => void): void
  // Register a tray/menu item
  registerMenuItem(label: string, handler: () => void): void
}

export interface IKVStorage {
  get<T>(key: string): T | null
  set<T>(key: string, value: T): void
  remove(key: string): void
}

export interface IEventBus {
  on<T>(event: string, cb: (payload: T) => void): () => void
  emit<T>(event: string, payload: T): void
}

// Standard events emitted by core:
// 'playback:change'  → PlaybackState
// 'track:start'      → Track
// 'track:end'        → { track: Track, listenedSecs: number }
// 'tracks:load'      → Track[]
// 'app:close'        → void

export interface IPlayer {
  play(): void
  pause(): void
  stop(): void
  next(): void
  prev(): void
  seek(seconds: number): void
  loadTracks(tracks: Track[]): void
  getState(): PlaybackState
}

export interface ModuleContext {
  player: IPlayer
  events: IEventBus
  ui: IUIRegistry
  storage: IKVStorage
  transport: ITransport   // Tauri IPC or HTTP — same interface as today
}
```

---

### GoampCore — the assembler

```typescript
// src/core/GoampCore.ts

export class GoampCore {
  private _renderer: IRenderer | null = null
  private _sources: ISource[] = []
  private _features: IFeature[] = []

  renderer(r: IRenderer): this { this._renderer = r; return this }
  source(s: ISource): this { this._sources.push(s); return this }
  feature(f: IFeature): this { this._features.push(f); return this }

  async start(container: HTMLElement): Promise<void> {
    // 1. Build shared context
    const ctx = this.buildContext()

    // 2. Mount renderer
    await this._renderer!.mount(container, ctx)

    // 3. Wire renderer → player commands
    this.wireRenderer(ctx)

    // 4. Init sources
    for (const s of this._sources) await s.init(ctx)

    // 5. Init features
    for (const f of this._features) await f.init(ctx)
  }
}
```

---

## Directory Structure

```
src/
  core/
    types.ts            ← Track, PlaybackState, etc.
    IRenderer.ts
    ISource.ts
    IFeature.ts
    ModuleContext.ts
    GoampCore.ts
    EventBus.ts
    KVStorage.ts

  renderers/
    webamp/
      WebampRenderer.ts  ← wraps PlayerStore + PlayerEvents
      PlayerStore.ts     ← stays as-is (internal impl detail)
      PlayerEvents.ts    ← stays as-is

  sources/
    local/
      LocalSource.ts     ← file scanning, convertFileSrc
    youtube/
      YouTubeSource.ts
    spotify/             ← future
      SpotifySource.ts
    yandex/              ← future
      YandexSource.ts

  features/
    playlists/
      PlaylistFeature.ts ← wraps PlaylistService
    scrobble/
      ScrobbleFeature.ts ← wraps ScrobbleService
    history/
      HistoryFeature.ts  ← wraps HistoryService
    radio/
      RadioFeature.ts    ← wraps RadioService
    recommendations/
      RecommendationsFeature.ts
    p2p/
      P2PFeature.ts      ← libp2p node (coming next)

  services/              ← stays as-is (internal to features)
    transport.ts
    interfaces.ts
    PlaylistService.ts
    ScrobbleService.ts
    ...

  main.ts                ← assembly only
```

---

## Assembly Example

```typescript
// src/main.ts — читается как конфиг, не как код

import { GoampCore } from './core/GoampCore'
import { WebampRenderer } from './renderers/webamp/WebampRenderer'
import { LocalSource } from './sources/local/LocalSource'
import { YouTubeSource } from './sources/youtube/YouTubeSource'
import { PlaylistFeature } from './features/playlists/PlaylistFeature'
import { ScrobbleFeature } from './features/scrobble/ScrobbleFeature'
import { HistoryFeature } from './features/history/HistoryFeature'
import { RadioFeature } from './features/radio/RadioFeature'
import { RecommendationsFeature } from './features/recommendations/RecommendationsFeature'
import { P2PFeature } from './features/p2p/P2PFeature'
import { TauriTransport } from './services/transport'
import { initAnalytics, track } from './lib/analytics'

initAnalytics()

await new GoampCore()
  .renderer(new WebampRenderer())
  .source(new LocalSource(new TauriTransport()))
  .source(new YouTubeSource(new TauriTransport()))
  .feature(new PlaylistFeature(new TauriTransport()))
  .feature(new HistoryFeature(new TauriTransport()))
  .feature(new ScrobbleFeature(new TauriTransport()))
  .feature(new RadioFeature(new TauriTransport()))
  .feature(new RecommendationsFeature(new TauriTransport()))
  .feature(new P2PFeature(new TauriTransport()))
  .start(document.getElementById('app')!)

track('app_launched')
```

---

## Migration Map (existing code → new structure)

| Было | Станет |
|------|--------|
| `src/player/PlayerStore.ts` | `src/renderers/webamp/PlayerStore.ts` (internal) |
| `src/player/PlayerEvents.ts` | `src/renderers/webamp/PlayerEvents.ts` (internal) |
| `src/bootstrap/AppBootstrap.ts` | `GoampCore.start()` |
| `src/bootstrap/session.ts` | часть `PlaylistFeature` |
| `src/bootstrap/keyboard.ts` | `ctx.ui.registerShortcut()` внутри каждого модуля |
| `src/services/PlaylistService.ts` | внутри `PlaylistFeature` |
| `src/services/ScrobbleService.ts` | внутри `ScrobbleFeature` |
| `src/services/RadioService.ts` | внутри `RadioFeature` |
| `src/services/RecommendationService.ts` | внутри `RecommendationsFeature` |
| `src/services/HistoryService.ts` | внутри `HistoryFeature` |
| `src/services/SettingsService.ts` | shared, доступен через `ctx.transport` |
| `src/services/transport.ts` | `src/services/transport.ts` (без изменений) |
| `src/webamp/*` (панели) | внутри `WebampRenderer` или соответствующих features |

Сервисы (`PlaylistService`, `ScrobbleService` и т.д.) **не удаляются** — они остаются как внутренняя реализация внутри своих feature-модулей.

---

## Rules

1. **Core не импортирует ничего** из `renderers/`, `sources/`, `features/`
2. **Модули не импортируют друг друга** напрямую — только через `ctx.events` или `ctx.player`
3. **Сервисы (`src/services/`)** — internal detail модулей, не публичный API
4. **`ITransport`** — единственный способ общения с Rust/Go бэкендом
5. **Каждый модуль тестируется изолированно** через `MockTransport` + mock `ModuleContext`

---

## Implementation Plan

### Phase 1 — Core interfaces (no existing code changes)
- Написать `src/core/types.ts`, `IRenderer.ts`, `ISource.ts`, `IFeature.ts`, `ModuleContext.ts`
- Написать `GoampCore.ts`, `EventBus.ts`, `KVStorage.ts`
- Тесты для `EventBus`, `KVStorage`, `GoampCore` (с mock renderer/source/feature)

### Phase 2 — WebampRenderer
- Написать `src/renderers/webamp/WebampRenderer.ts` — адаптер над `PlayerStore`
- Переместить `PlayerStore`, `PlayerEvents` в `src/renderers/webamp/`
- `WebampRenderer` реализует `IRenderer`

### Phase 3 — Завернуть features
- Каждый существующий сервис → `IFeature` обёртка
- Порядок: `PlaylistFeature` → `HistoryFeature` → `ScrobbleFeature` → `RadioFeature` → `RecommendationsFeature`
- Клавиатурные шорткаты → `ctx.ui.registerShortcut()` внутри соответствующего feature

### Phase 4 — Sources
- `LocalSource` (file scanning + `convertFileSrc`)
- `YouTubeSource` (уже есть вся логика)

### Phase 5 — Assembly
- Переписать `main.ts` на новый API
- Удалить `AppBootstrap.ts`

### Phase 6 — P2PFeature (libp2p)
- Первый "новый" модуль написанный полностью в новой архитектуре
