## 1. Icon pack

- [x] 1.1 Add `charts`, `peers`, `folder`, `note` glyphs to `ICONS` in `src/webamp/retro.ts` (8×8 crispEdges, matching `close` style)
- [x] 1.2 Extend `retro.test.ts`: each new glyph resolves non-empty; unknown name still `''`

## 2. Registry contract

- [x] 2.1 Add optional trailing `icon?: string` to `registerMenuItem` in `src/core/ModuleContext.ts` (IUIRegistry)
- [x] 2.2 Add `icon?` to `MenuItemEntry` and store it in `src/core/UIRegistry.ts`
- [x] 2.3 Add/extend UIRegistry test: item stored with icon; without icon leaves it undefined

## 3. Menu render

- [x] 3.1 Add `icon?: string` to `MenuItem` and carry `i.icon` through `buildDynamicMenuItems` in `src/webamp/goamp-menu.ts`
- [x] 3.2 In the render loop, prepend an icon span via `retroIcon(item.icon)` when it resolves non-empty; skip entirely when empty
- [x] 3.3 Test: icon-bearing dynamic row renders an `svg`; icon-less row does not

## 4. Wire consumers

- [x] 4.1 `ChartsFeature.ts`: pass `'charts'` icon to `registerMenuItem`
- [x] 4.2 `P2PFeature.ts`: pass `'peers'` icon to `registerMenuItem`

## 5. Verify

- [x] 5.1 `pnpm test --run` green; `pnpm exec tsc --noEmit` clean
- [x] 5.2 `openspec validate retro-menu-icons --strict` passes
