# Frontend Architecture Refactor + goamp-node HTTP Migration

**Date:** 2026-04-16  
**Status:** Approved

## Problem

The frontend has three compounding issues:

1. **`bridge.ts` is a god file** (547 lines) — scrobbling, history tracking, session save/restore, media keys, keyboard shortcuts, and panel initialization all in one place. Any change cascades.
2. **`tauri-ipc.ts` is a flat invoke list** (363 lines) — no domain grouping, no abstraction. Every panel imports directly; changing one command signature breaks multiple consumers.
3. **`(webamp as any).store` scattered everywhere** — the internal Redux store is accessed via `any` casts in 5+ places. TypeScript can't catch errors; any webamp update can silently break things.

Result: every change requires many follow-up fixes. Tests are hard to write because everything depends on Tauri's `invoke()`.

## Goal

- Changes to one domain (e.g. scrobbling) do not break another (e.g. playlists)
- Frontend tests run without Tauri — no `invoke()`, no `window.__TAURI_INTERNALS__`
- Architecture naturally supports future remote control and sync via goamp-node HTTP

## Architecture

### Phase 1: Frontend Service Layer

```
main.ts
  └── PlayerStore          ← single class wrapping (webamp as any).store
  └── AppBootstrap         ← replaces bridge.ts (thin wiring only)
        ├── PlaylistService
        ├── ScrobbleService
        ├── HistoryService
        ├── RadioService
        ├── RecommendationService
        └── SettingsService
```

Each service:
- Implements a typed interface
- Internally calls `TauriTransport` (wraps `invoke`)
- Has no knowledge of UI or webamp
- Is testable via `MockTransport`

### Phase 2: HTTP Transport (goamp-node)

Services are transport-agnostic. When goamp-node exposes an HTTP API for a domain, that service switches from `TauriTransport` to `HttpTransport`. The frontend doesn't change.

```
Service → ITransport
            ├── TauriTransport  (invoke — Phase 1)
            └── HttpTransport   (fetch → goamp-node — Phase 2)
```

Remote control (phone → desktop) is enabled by Phase 2 for free: the same HTTP API that the frontend uses is accessible from any device on the local network.

## File Structure

```
src/
  services/
    interfaces.ts           ← all service TypeScript interfaces
    transport.ts            ← ITransport, TauriTransport, (later) HttpTransport
    PlaylistService.ts
    ScrobbleService.ts
    HistoryService.ts
    RadioService.ts
    RecommendationService.ts
    SettingsService.ts
    index.ts                ← instantiates and exports all services
  player/
    PlayerStore.ts          ← only place with (webamp as any).store
    PlayerEvents.ts         ← typed event emitter (onTrackChange, etc.)
  bootstrap/
    AppBootstrap.ts         ← replaces bridge.ts
    keyboard.ts             ← keyboard shortcuts
    session.ts              ← session save/restore
  lib/
    tauri-ipc.ts            ← kept, reorganized by domain; empties out as Phase 2 progresses
```

## PlayerStore

Single class owning all webamp internal access:

```ts
class PlayerStore {
  getStatus(): "PLAYING" | "PAUSED" | "STOPPED"
  getTimeElapsed(): number
  getTracks(): Track[]
  dispatch(action: PlayerAction): void
  onTrackChange(cb: (track: TrackInfo | null) => void): Unsubscribe
}
```

No other file in the codebase may use `(webamp as any)`.

## ITransport

```ts
interface ITransport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

class TauriTransport implements ITransport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return invoke(command, args);
  }
}
```

## Testing

- Tests are frontend-only. No Tauri, no `invoke`, no `window.__TAURI_INTERNALS__`.
- Each service is tested with `MockTransport`.
- Panels are tested with mock service implementations.
- `TauriTransport` itself is not tested — it is a thin native boundary.

```ts
// Service test
const svc = new PlaylistService(new MockTransport());
await svc.create("My Mix");
expect(mockTransport.lastCall).toEqual({ command: "create_playlist", args: { name: "My Mix" } });

// Panel test
const panel = new PlaylistPanel(new MockPlaylistService());
// ... assert UI behavior
```

## Migration Order (Phase 1)

1. `PlayerStore` — isolate all `(webamp as any).store` accesses
2. `PlayerEvents` — typed event bus replacing raw `webamp.onTrackDidChange` callbacks
3. `ITransport` + `TauriTransport` — wrap `invoke`
4. Extract services one domain at a time, in order:
   - `PlaylistService`
   - `ScrobbleService`
   - `HistoryService`
   - `RadioService`
   - `RecommendationService`
   - `SettingsService`
5. `AppBootstrap` — `bridge.ts` becomes thin wiring, eventually deleted

Each step: app works, tests pass.

## Migration Order (Phase 2)

For each domain migrated to goamp-node HTTP:

1. Add HTTP endpoints to goamp-node
2. Implement `HttpTransport` for that domain
3. Switch service to `HttpTransport`
4. Remove corresponding Tauri commands from Rust

When `tauri-ipc.ts` is empty, delete it.

## Constraints

- `bridge.ts` is not deleted in one shot — it shrinks step by step
- `tauri-ipc.ts` is not deleted until Phase 2 is complete for all domains
- Tauri stays responsible for: file dialogs, system tray, media keys, window management, audio playback
- goamp-node takes responsibility for: playlists, history, scrobbling, recommendations, radio favorites
