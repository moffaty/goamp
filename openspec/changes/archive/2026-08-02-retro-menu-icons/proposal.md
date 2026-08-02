## Why

Feature-registered menu items ("Charts", "Peers") and the panels they open render
as bare green text. The retro window chrome (`src/webamp/retro.ts`) already ships
a pixel icon pack and `retroIcon()`, but it holds only a single `close` glyph, so
nothing in the menu can look Winamp-authentic yet. Populating the pack and letting
menu entries carry a glyph closes that gap without new dependencies.

## What Changes

- Add pixel glyphs (`charts`, `peers`, `folder`, `note`) to the `ICONS` pack in
  `retro.ts`, alongside the existing `close`.
- Extend the UI registry menu contract so a registered menu item may carry an
  optional icon name: `registerMenuItem(label, handler, icon?)`. Existing callers
  (no icon arg) keep working unchanged — non-breaking.
- Render the icon (inline SVG from the pack) before the label in the goamp context
  menu. Items without an icon render exactly as today.
- Wire the two current dynamic items to glyphs: Charts → `charts`, Peers → `peers`.

## Capabilities

### New Capabilities
- `retro-icons`: the pixel icon pack (named 8×8 inline-SVG glyphs, `retroIcon`
  lookup) and its use as optional icons on registry-registered menu items.

### Modified Capabilities
<!-- none — no existing openspec/specs to modify (fresh init) -->

## Impact

- `src/webamp/retro.ts` — new glyphs in `ICONS`.
- `src/core/ModuleContext.ts`, `src/core/UIRegistry.ts` — optional `icon` param on
  `registerMenuItem`; `MenuItemEntry` gains optional `icon`.
- `src/webamp/goamp-menu.ts` — `buildDynamicMenuItems` carries the icon; render
  loop prepends the glyph.
- `src/features/charts/ChartsFeature.ts`, `src/features/p2p/P2PFeature.ts` — pass
  icon names.
- Tests: `retro.test.ts`, `goamp-menu` menu tests, UIRegistry test.
- No Rust, no Go, no new dependencies.
