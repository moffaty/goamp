## Approach

Smallest diff; no new files, no deps. Thread an optional storage into `PanelHost`
and add a drag-end callback to `retroWindow`.

## PanelHost

```ts
constructor(registry, private readonly storage?: IKVStorage) {}
private topZ = 19000
```

- Key: `panel-pos:<id>` → `{ left: number; top: number }`.
- On first open (mount): read saved pos via `storage?.get`; if present, `clamp()` it
  to the viewport; else default `{left:120, top:120}`. Apply to `container.style`.
- `clamp(pos)`: `left = min(max(0, pos.left), innerWidth - MARGIN)`, same for top with
  `innerHeight - MARGIN`. MARGIN keeps the titlebar grabbable (e.g. 40px). // ponytail: clamps to a fixed margin, not real panel size — good enough until panels vary wildly.
- `bringToFront(container)`: `container.style.zIndex = String(++this.topZ)`. Called on
  container `mousedown` (capture not needed) and once at mount.
- Pass `onDragEnd: (left, top) => storage?.set('panel-pos:'+id, clamp({left,top}))` into
  `retroWindow`.

Storage optional ⇒ every `new PanelHost(registry)` in tests keeps compiling and just
skips persistence.

## retroWindow

Add `onDragEnd?: (left: number, top: number) => void` to opts. In the existing `up`
handler (mouseup that ends a drag), after removing listeners, read the target's
`style.left/top` (strip `px`) and call `onDragEnd?.(left, top)`. No behavior change
when the callback is absent.

## WebampUIFeature

`new PanelHost(registry, ctx.storage)`.

## Testing

- `retro.test.ts`: dragging fires `onDragEnd` with the moved coords.
- `PanelHost.test.ts`:
  - reopen restores a saved position (inject a stub `IKVStorage`);
  - a saved off-screen position is clamped on open;
  - mousedown on a panel raises its `zIndex` above another open panel;
  - no-storage `PanelHost` still opens at default and doesn't throw.
