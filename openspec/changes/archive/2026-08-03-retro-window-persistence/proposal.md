## Why

Retro panels (charts, peers, …) always open at the same fixed spot, forget where
you dragged them, and never rise above their siblings when clicked. That reads as a
web widget, not a Winamp window. Persisting position and honoring z-order is the
next incremental step toward authentic gen-window behavior — without forking Webamp.

## What Changes

- `PanelHost` remembers each panel's last dragged position and restores it on
  reopen, clamped into the viewport (never off-screen).
- Clicking anywhere on a panel raises it above the others (focus-to-front).
- Position is persisted via the existing `IKVStorage`; `PanelHost` takes an optional
  storage arg — omitted (tests, no-storage env) means no persistence, unchanged.
- `retroWindow` gains an optional `onDragEnd(left, top)` callback so the host can
  save the final position after a drag.

## Capabilities

### New Capabilities
- `retro-window-state`: position persistence, viewport clamping, and click-to-front
  z-ordering for host-mounted retro panels.

### Modified Capabilities
<!-- none — retro-icons spec covers chrome/glyphs, not window state -->

## Impact

- `src/webamp/PanelHost.ts` — optional storage, restore/clamp on open, z-order on
  mousedown, save on drag end.
- `src/webamp/retro.ts` — optional `onDragEnd` in `retroWindow` opts.
- `src/renderers/webamp/WebampUIFeature.ts` — pass `ctx.storage` to `PanelHost`.
- Tests: `PanelHost.test.ts`, `retro.test.ts`.
- No Rust, no Go, no new dependencies.
