## Approach

Smallest diff that threads an optional glyph name from registration to render.
No new files, no new deps — extend the three seams that already exist.

## 1. Icon pack (`src/webamp/retro.ts`)

Add four glyphs to `ICONS` next to `close`. Same style as `close`: an 8×8
`viewBox`, `shape-rendering="crispEdges"`, `fill="#c8c8ff"`, built from `<rect>`
pixels. `retroIcon()` already returns `ICONS[name] ?? ''` — no change needed.

- `charts` — ascending bar-chart columns.
- `peers` — two linked nodes.
- `folder` — classic folder tab.
- `note` — eighth note.

Pixels are hand-authored; exact shapes are cosmetic and not spec-constrained.

## 2. Registry contract (`ModuleContext.ts`, `UIRegistry.ts`)

```ts
// ModuleContext.ts (IUIRegistry)
registerMenuItem(label: string, handler: () => void, icon?: string): void

// UIRegistry.ts
export interface MenuItemEntry { label: string; handler: () => void; icon?: string }
registerMenuItem(label, handler, icon?) { this._menuItems.push({ label, handler, icon }) }
```

`icon?` is optional and trailing, so every existing call site keeps compiling —
non-breaking by construction.

## 3. Menu shape + render (`src/webamp/goamp-menu.ts`)

- `MenuItem` gains `icon?: string`.
- `buildDynamicMenuItems` maps `i.icon` through:
  `{ label: i.label, action: i.handler, icon: i.icon }`.
- In the render loop, before the label span, if `item.icon` resolves via
  `retroIcon(item.icon)` to non-empty markup, prepend a small span:
  `iconSpan.innerHTML = retroIcon(item.icon)` with `display:inline-flex;
  margin-right:6px;`. Empty markup ⇒ skip the span entirely (no gap).

Built-in items pass no icon, so they are visually unchanged. Only the dynamic
(registry) items opt in here.

## 4. Wire the two current consumers

- `ChartsFeature.ts`: `registerMenuItem('Charts', …, 'charts')`
- `P2PFeature.ts`: `registerMenuItem('Peers', …, 'peers')`

`folder`/`note` ship in the pack for imminent reuse (Open Folder, now-playing)
but are not wired to built-ins in this change — built-ins live in a static array
and rewiring all of them is out of scope. // ponytail: glyphs ready, wire built-ins when that array is touched.

## Testing

- `retro.test.ts`: `retroIcon('charts')` non-empty; unknown still `''`.
- `goamp-menu` test: `buildDynamicMenuItems` carries `icon`; a rendered
  icon-bearing row contains an `svg`, an icon-less row does not.
- `UIRegistry` test: `registerMenuItem` with icon stores it; without icon leaves
  it undefined.
