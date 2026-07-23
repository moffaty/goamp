import type { UIRegistry } from '../core/UIRegistry'

/**
 * Generic host for panels registered via `ctx.ui.registerPanel(id, render)`.
 * Lazy: the render fn runs on first open; later toggles just flip visibility.
 * Reads `registry.panels` live, so panels registered after the host is created
 * (any feature init order) still resolve.
 */
export class PanelHost {
  private mounted = new Map<string, HTMLElement>()

  constructor(private readonly registry: UIRegistry) {}

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
    container.style.cssText = 'position:fixed;top:120px;left:120px;z-index:19000;'
    container.appendChild(render())
    document.body.appendChild(container)
    this.mounted.set(id, container)
  }

  destroy(): void {
    for (const el of this.mounted.values()) el.remove()
    this.mounted.clear()
  }
}
