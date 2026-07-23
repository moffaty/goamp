# UIRegistry Wiring: No-Op Stubs to Real Webamp UI

**Date:** 2026-07-24
**Status:** IMPLEMENTED (pending code review)
**Scope:** Wire `IUIRegistry` so that `registerPanel`, `registerMenuItem`, and `registerShortcut` actually collect registrations and the Webamp renderer consumes them live.

## Context

`GoampCore.buildUI()` (src/core/GoampCore.ts:120-126) returns an `IUIRegistry` where every method is a no-op `() => {}`. Modules like `P2PFeature` already call `ctx.ui.registerPanel('p2p-peers', ...)` and `ctx.ui.registerMenuItem('Peers', ...)` during `init()`, but nothing renders because the calls are swallowed.

The Webamp renderer side (`WebampUIFeature`) initialises all panels and the context menu today. The context menu (`goamp-menu.ts`) builds a hardcoded `MenuItem[]` array on every right-click. Panels are standalone modules with their own `init*Panel()` + `toggle*()` patterns.

**This plan is additive.** Existing hardcoded menu items and standalone panels are untouched.

## Design Decisions

### Concrete `UIRegistry` class (not interface extension)
The `IUIRegistry` interface stays as-is (write-only register methods -- the public contract for modules). A new concrete `UIRegistry` class implements `IUIRegistry` and adds read-access getters (`panels`, `menuItems`, `shortcuts`). `WebampUIFeature` receives the concrete type. This is lower-churn than extending the interface: no module code changes, no import changes, only `GoampCore` and `WebampUIFeature` know about the concrete class.

### Live reads, not snapshots
**Critical ordering constraint:** `WebampUIFeature.init` runs among features. Other features (e.g. `P2PFeature`) register their items in THEIR `init`, which may run AFTER `WebampUIFeature`. Therefore the webamp side must read the registry LIVE (at right-click / keydown / panel-open time), NOT snapshot it at init time. This makes registration order irrelevant.

### Panel host: minimal lazy mount
A registered panel (`id`, `render`) is opened via `togglePanel(id)` on the registry. On first call for a given `id`, it calls `render()`, wraps the result in a positioned container, appends to `document.body`, and shows it. Subsequent calls toggle visibility. This mirrors the existing `toggle*()` pattern used by hardcoded panels. The `togglePanel` method lives on the concrete `UIRegistry` class (not on `IUIRegistry` -- modules don't call it; menu item handlers do).

### Shortcuts: DEFER (YAGNI)
No module currently registers a shortcut. The `UIRegistry` will collect them (for forward-compat), but no keydown listener will be wired. A `// TODO` note marks the binding point. This avoids building a key-combo parser nobody uses yet.

### Menu item wiring
`showGoampMenu` appends registry menu items (under a separator) to its hardcoded `items[]` each time it opens. `initGoampMenu` gains a second parameter: the registry. It reads `registry.menuItems` live inside `showGoampMenu`.

---

## Files Touched

| File | Change |
|------|--------|
| `src/core/UIRegistry.ts` | **NEW** -- concrete class |
| `src/core/UIRegistry.test.ts` | **NEW** -- unit tests |
| `src/core/ModuleContext.ts` | No change (interface stays) |
| `src/core/GoampCore.ts` | `buildUI()` returns `new UIRegistry()` |
| `src/core/GoampCore.test.ts` | Add tests verifying registry collects registrations |
| `src/webamp/goamp-menu.ts` | `initGoampMenu(webamp, registry)`, `showGoampMenu` appends dynamic items |
| `src/webamp/goamp-menu.test.ts` | **NEW** -- test `buildMenuItems` seam with registry |
| `src/webamp/PanelHost.ts` | **NEW** -- tiny generic panel toggle host |
| `src/webamp/PanelHost.test.ts` | **NEW** -- DOM-light toggle tests |
| `src/renderers/webamp/WebampUIFeature.ts` | Pass registry to `initGoampMenu`; wire panel host |
| `src/features/p2p/P2PFeature.ts` | Update `registerMenuItem` handler to call `registry.togglePanel('p2p-peers')` |
| `src/features/p2p/P2PFeature.test.ts` | Verify menu item handler calls togglePanel |

---

## Task 1: UIRegistry concrete class + unit tests

**TDD: write tests first.**

### Tests (src/core/UIRegistry.test.ts)
- [x] `registerPanel(id, render)` stores entry; `registry.panels` returns it
- [x] `registerPanel` with duplicate `id` overwrites (last-write-wins)
- [x] `registerMenuItem(label, handler)` appends; `registry.menuItems` returns all in order
- [x] `registerShortcut(keys, handler)` appends; `registry.shortcuts` returns all
- [x] Implements `IUIRegistry` (type-level check: `const r: IUIRegistry = new UIRegistry()`)

### Implementation (src/core/UIRegistry.ts)
- [x] Class `UIRegistry` implements `IUIRegistry`
- [x] Private `_panels: Map<string, () => HTMLElement>`
- [x] Private `_menuItems: Array<{ label: string; handler: () => void }>`
- [x] Private `_shortcuts: Array<{ keys: string; handler: () => void }>`
- [x] `registerPanel(id, render)` -- sets in map
- [x] `registerMenuItem(label, handler)` -- pushes to array
- [x] `registerShortcut(keys, handler)` -- pushes to array
- [x] Read-only getters: `get panels()`, `get menuItems()`, `get shortcuts()`
- [x] `togglePanel(id)` method -- delegates to PanelHost if set, else NO-OP (never throws). A registry without a DOM host (test env, headless) must tolerate `togglePanel` calls silently. This resolves the earlier draft's Task1/Task6 contradiction: no-op wins.

### Acceptance criteria
- `pnpm test --run src/core/UIRegistry.test.ts` passes
- `pnpm exec tsc --noEmit` passes

---

## Task 2: GoampCore uses UIRegistry

**TDD: extend existing GoampCore tests first.**

### Tests (src/core/GoampCore.test.ts -- new describe block)
- [x] After `core.start()`, the `ctx.ui` passed to features is a real `UIRegistry` (not a mock)
- [x] A feature that calls `ctx.ui.registerPanel('x', renderFn)` during `init` -- the panel is present in the registry's `panels` map after start
- [x] A feature that calls `ctx.ui.registerMenuItem('X', handler)` -- item appears in `menuItems`

### Implementation (src/core/GoampCore.ts)
- [x] Import `UIRegistry` from `./UIRegistry`
- [x] `buildUI()` returns `new UIRegistry()` instead of the no-op object literal
- [x] No other changes to GoampCore

### Acceptance criteria
- All existing GoampCore tests still pass (no regression)
- New tests pass
- `pnpm exec tsc --noEmit` passes

---

## Task 3: PanelHost -- generic lazy panel mount/toggle

**TDD: write DOM-light tests first.**

### Tests (src/webamp/PanelHost.test.ts)
- [x] `host.toggle(id)` when panel is registered: first call mounts the rendered element into a container in `document.body`, element is visible
- [x] `host.toggle(id)` second call: element is hidden (display:none)
- [x] `host.toggle(id)` third call: element is visible again (no re-render -- `render` called exactly once)
- [x] `host.toggle(unknownId)` does nothing (no throw, no DOM change)
- [x] Multiple panels: toggling `'a'` does not affect `'b'`

### Implementation (src/webamp/PanelHost.ts)
- [x] Class `PanelHost` takes a `UIRegistry` in constructor (reads `registry.panels` live)
- [x] `toggle(id: string): void`
  - If `id` not in `registry.panels`, return silently
  - If not yet mounted: call `registry.panels.get(id)!()`, wrap in a container div (class `goamp-dynamic-panel`, positioned like existing panels), append to `document.body`, store reference
  - If already mounted: toggle `display` between `''` and `'none'`
- [x] `destroy(): void` -- removes all mounted containers (cleanup, minimal)

### Wire into UIRegistry
- [x] `UIRegistry` gets a `setPanelHost(host: PanelHost)` method
- [x] `UIRegistry.togglePanel(id)` delegates to `this.panelHost.toggle(id)`

### Acceptance criteria
- `pnpm test --run src/webamp/PanelHost.test.ts` passes
- `pnpm exec tsc --noEmit` passes

---

## Task 4: Context menu reads registry live

**TDD: extract testable seam, write tests first.**

### Testable seam
Extract a pure function `buildDynamicMenuItems(registry: UIRegistry): MenuItem[]` from `goamp-menu.ts` that reads `registry.menuItems` and returns `MenuItem[]` entries (with the handler mapped through). This function is testable without DOM or Webamp.

### Tests (src/webamp/goamp-menu.test.ts)
- [x] `buildDynamicMenuItems` with empty registry returns `[]`
- [x] `buildDynamicMenuItems` with 2 registered items returns 2 `MenuItem` objects with correct labels
- [x] Calling the returned `MenuItem.action` invokes the original handler
- [x] First item has `separator: true` (the divider before dynamic items)
- [x] Items registered AFTER `buildDynamicMenuItems` was last called appear on NEXT call (proves live read)

### Implementation (src/webamp/goamp-menu.ts)
- [x] Add `export function buildDynamicMenuItems(registry: UIRegistry): MenuItem[]`
  - Returns `[{ separator, label: '', action: noop }, ...registry.menuItems.map(i => ({ label: i.label, action: i.handler }))]` if menuItems is non-empty; `[]` if empty
- [x] Change `initGoampMenu(webamp: Webamp, registry?: UIRegistry)` -- store registry ref (optional for backward compat, though all call sites will pass it)
- [x] In `showGoampMenu`, after building hardcoded `items[]` and signal items, append `...buildDynamicMenuItems(registry)` if registry is set
- [x] Export `MenuItem` type for test use

### Acceptance criteria
- `pnpm test --run src/webamp/goamp-menu.test.ts` passes
- Existing hardcoded menu items unchanged
- `pnpm exec tsc --noEmit` passes

---

## Task 5: WebampUIFeature wiring + P2PFeature handler update

**TDD: update P2PFeature test first.**

### Tests (src/features/p2p/P2PFeature.test.ts -- update)
- [x] Update `makeCtx()` to use real `UIRegistry` instead of `vi.fn()` mocks
- [x] After `feature.init(ctx)`, `ctx.ui.menuItems` contains an entry with label `'Peers'`
- [x] Calling the Peers menu item handler invokes `registry.togglePanel('p2p-peers')` (spy/mock the method)
- [x] All existing P2PFeature tests still pass

### Implementation

**P2PFeature.ts:**
- [x] The `registerMenuItem('Peers', ...)` handler needs access to `togglePanel`. Two options:
  - (A) `ctx.ui.registerMenuItem('Peers', () => ctx.ui.registerPanel && /* ??? */)` -- ugly, no access to togglePanel on interface
  - (B) The handler calls `(ctx.ui as any).togglePanel('p2p-peers')` -- works but type-unsafe
  - **(C) Recommended:** Add `togglePanel(id: string): void` to `IUIRegistry` interface. It is the ONE addition. Modules that register a panel reasonably want to open it. This is a one-line interface change, zero churn elsewhere.
- [x] Update `IUIRegistry` in `ModuleContext.ts`: add `togglePanel(id: string): void`
- [x] Update `P2PFeature.ts` line 40: `ctx.ui.registerMenuItem('Peers', () => ctx.ui.togglePanel('p2p-peers'))`

**WebampUIFeature.ts:**
- [x] Import `UIRegistry` and `PanelHost`
- [x] Access the concrete registry via `const registry = ctx.ui as UIRegistry` — `ctx.ui` IS the instance `GoampCore.buildUI()` created (buildContext builds it once, passes the same ctx to every module), so the cast is safe. Guard defensively is unnecessary.
- [x] Create `PanelHost` with the registry, call `registry.setPanelHost(panelHost)`
- [x] Pass registry to `initGoampMenu(this.webamp, registry)`
- [x] Add `panelHost.destroy()` to cleanup

**GoampCore.ts (if needed):**
- [x] The `ModuleContext.ui` is typed as `IUIRegistry`. Since `togglePanel` is now on the interface, and `UIRegistry` implements it, no cast is needed. Modules call `ctx.ui.togglePanel(id)` naturally.

### Acceptance criteria
- `pnpm test --run` (full suite) passes
- `pnpm exec tsc --noEmit` passes
- Right-clicking in Webamp shows "Peers" in the context menu (manual check)
- Clicking "Peers" opens the P2P peer panel
- Clicking "Peers" again hides it

---

## Task 6: Final integration smoke + cleanup

- [x] Run `pnpm test --run` -- all tests pass
- [x] Run `pnpm exec tsc --noEmit` -- no type errors
- [x] Verify no Tauri imports leaked into core/ or features/ test files
- [x] Verify `UIRegistry.togglePanel` no-ops gracefully when PanelHost is not set (for test environments where no DOM host is wired)
- [x] Add `// TODO: wire shortcut keydown listener when a module registers shortcuts` comment in `WebampUIFeature.ts`

---

## Verify Commands

```bash
pnpm test --run
pnpm exec tsc --noEmit
```

---

## Out of Scope

- **Migrating existing hardcoded panels** (Search, Playlists, Radio, etc.) to use `registerPanel` -- follow-up task; this plan is additive only.
- **Shortcut key binding** -- no module registers shortcuts yet. Collection is implemented; binding is deferred (YAGNI).
- **Panel positioning/styling** -- PanelHost uses a simple absolute-positioned container. Matching existing panel aesthetics (draggable, resizable, Winamp-style chrome) is a follow-up.
- **Per-module cleanup / unregister** -- single app instance, no hot-reload. A `// NOTE` documents the assumption.
- **Migrating existing hardcoded menu items** to `registerMenuItem` calls inside their respective features.

---

## Ground Truth Corrections

None. All stated facts matched the codebase exactly.

## Design Note: togglePanel on IUIRegistry

The original constraint said "the concrete class can expose extra read members" and suggested keeping `IUIRegistry` write-only. However, Task 5 analysis reveals that `P2PFeature` (and any future feature) needs to open its own panel from its menu item handler, and it only has access to `ctx.ui: IUIRegistry`. Adding `togglePanel(id: string): void` to the interface is the cleanest solution -- it is a single line, requires no type casts, and is semantically correct (toggling a panel is a UI registration concern). The alternative (casting to concrete type inside every feature) is worse.
