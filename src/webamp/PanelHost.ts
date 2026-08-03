import type { UIRegistry } from '../core/UIRegistry'
import type { IKVStorage } from '../core/KVStorage'
import { retroWindow, prettifyPanelId } from './retro'

/** Keep at least this much of a panel on-screen so its titlebar stays grabbable. */
const MARGIN = 40
type Pos = { left: number; top: number }

/**
 * Generic host for panels registered via `ctx.ui.registerPanel(id, render)`.
 * Lazy: the render fn runs on first open; later toggles just flip visibility.
 * Reads `registry.panels` live, so panels registered after the host is created
 * (any feature init order) still resolve.
 */
export class PanelHost {
  private mounted = new Map<string, HTMLElement>()
  private topZ = 19000

  constructor(
    private readonly registry: UIRegistry,
    private readonly storage?: IKVStorage,
  ) {}

  toggle(id: string): void {
    const existing = this.mounted.get(id)
    if (existing) {
      existing.style.display = existing.style.display === 'none' ? '' : 'none'
      return
    }

    const render = this.registry.panels.get(id)
    if (!render) return // unknown id — silently ignore

    const container = document.createElement('div')
    container.className = 'goamp-dynamic-panel'
    container.dataset.panelId = id
    // Restore the last dragged position (clamped on-screen), else default.
    const saved = this.storage?.get<Pos>(this.posKey(id))
    const pos = this.clamp(saved ?? { left: 120, top: 120 })
    container.style.cssText = `position:fixed;left:${pos.left}px;top:${pos.top}px;`
    // Click anywhere on the panel raises it above the others.
    container.addEventListener('mousedown', () => this.bringToFront(container))
    // Wrap the panel body in retro Winamp chrome (draggable titlebar + close).
    const frame = retroWindow(
      {
        title: prettifyPanelId(id),
        onClose: () => this.toggle(id),
        dragTarget: container,
        onDragEnd: (left, top) => {
          const clamped = this.clamp({ left, top })
          this.storage?.set(this.posKey(id), clamped)
        },
      },
      render(),
    )
    container.appendChild(frame)
    document.body.appendChild(container)
    this.mounted.set(id, container)
    this.bringToFront(container)
  }

  private posKey(id: string): string {
    return `panel-pos:${id}`
  }

  private bringToFront(container: HTMLElement): void {
    container.style.zIndex = String(++this.topZ)
  }

  /** Keep the titlebar inside the viewport (never fully off-screen). */
  private clamp(pos: Pos): Pos {
    return {
      left: Math.min(Math.max(0, pos.left), Math.max(0, window.innerWidth - MARGIN)),
      top: Math.min(Math.max(0, pos.top), Math.max(0, window.innerHeight - MARGIN)),
    }
  }

  destroy(): void {
    for (const el of this.mounted.values()) el.remove()
    this.mounted.clear()
  }
}
