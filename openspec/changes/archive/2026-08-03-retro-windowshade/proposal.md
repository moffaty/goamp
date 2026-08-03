## Why

Winamp's signature "windowshade" mode collapses a window to just its titlebar on a
double-click, so you can park panels compactly without closing them. Retro panels
already have a draggable titlebar and remembered positions — windowshade is the
natural next authentic behavior.

## What Changes

- Double-clicking a retro window's titlebar collapses it to titlebar-only (hides the
  body); double-clicking again restores the body.
- The close button keeps working in both states; dragging is unaffected.

## Capabilities

### New Capabilities
- `retro-windowshade`: double-click-titlebar collapse/restore of a retro window body.

### Modified Capabilities
<!-- none -->

## Impact

- `src/webamp/retro.ts` — `retroWindow` titlebar gains a dblclick handler toggling the
  body's visibility.
- Tests: `retro.test.ts`.
- No Rust, no Go, no new dependencies. // ponytail: no persistence of shade state yet — add alongside panel-pos if users ask.
