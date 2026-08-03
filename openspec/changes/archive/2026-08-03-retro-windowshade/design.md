## Approach

One handler in `retroWindow`. No new files, no deps, no signature change.

- After `win.appendChild(body)`, attach a `dblclick` listener on the titlebar `bar`:
  toggle `body.style.display` between `''` and `'none'`.
- Guard against the close button: the close click already `stopPropagation`s, and a
  dblclick on it is unlikely, but keep the toggle keyed off `body` only so titlebar
  double-clicks are the sole trigger.
- Dragging (mousedown/mousemove) and `onDragEnd` are untouched — dblclick is a
  distinct event and does not start a drag.

## Testing

- `retro.test.ts`:
  - double-click titlebar hides body; second double-click restores it;
  - close still fires onClose after a collapse.
