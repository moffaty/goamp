import type { IUIRegistry } from './ModuleContext'

export interface MenuItemEntry {
  label: string
  handler: () => void
  /** Optional retro glyph name (see retroIcon); rendered before the label. */
  icon?: string
}

export interface ShortcutEntry {
  keys: string
  handler: () => void
}

/** Minimal contract the webamp-side PanelHost satisfies. Kept local to avoid a
 *  core → webamp import cycle. */
export interface PanelToggler {
  toggle(id: string): void
}

/**
 * Concrete IUIRegistry: modules call the register* methods during init(); the
 * renderer side reads `panels`/`menuItems`/`shortcuts` LIVE (registration order
 * is irrelevant since reads happen at right-click / panel-open time).
 */
export class UIRegistry implements IUIRegistry {
  private _panels = new Map<string, () => HTMLElement>()
  private _menuItems: MenuItemEntry[] = []
  private _shortcuts: ShortcutEntry[] = []
  private _host: PanelToggler | null = null

  registerPanel(id: string, render: () => HTMLElement): void {
    this._panels.set(id, render)
  }

  registerMenuItem(label: string, handler: () => void, icon?: string): void {
    this._menuItems.push({ label, handler, icon })
  }

  registerShortcut(keys: string, handler: () => void): void {
    this._shortcuts.push({ keys, handler })
  }

  /** Toggle a registered panel. No-ops if no host is wired (e.g. test env). */
  togglePanel(id: string): void {
    this._host?.toggle(id)
  }

  setPanelHost(host: PanelToggler): void {
    this._host = host
  }

  get panels(): ReadonlyMap<string, () => HTMLElement> {
    return this._panels
  }

  get menuItems(): readonly MenuItemEntry[] {
    return this._menuItems
  }

  get shortcuts(): readonly ShortcutEntry[] {
    return this._shortcuts
  }
}
