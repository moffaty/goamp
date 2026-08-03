## 1. retroWindow drag-end callback

- [x] 1.1 Add `onDragEnd?: (left, top) => void` to `retroWindow` opts; call it from the mouseup handler with the target's final left/top
- [x] 1.2 Test in `retro.test.ts`: simulated drag invokes `onDragEnd` with moved coords

## 2. PanelHost state

- [x] 2.1 Add optional `storage?: IKVStorage` ctor arg + `topZ` counter
- [x] 2.2 On open: restore `panel-pos:<id>` (clamped) or default; apply to container
- [x] 2.3 `bringToFront` on container mousedown and at mount
- [x] 2.4 Persist clamped position via `onDragEnd`
- [x] 2.5 Tests: restore, clamp off-screen, click-to-front, no-storage default

## 3. Wire + verify

- [x] 3.1 `WebampUIFeature`: `new PanelHost(registry, ctx.storage)`
- [x] 3.2 `pnpm test --run` green; `pnpm exec tsc --noEmit` clean
- [x] 3.3 `openspec validate retro-window-persistence --strict` passes
