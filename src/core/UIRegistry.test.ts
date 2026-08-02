import { describe, it, expect, vi } from 'vitest'
import { UIRegistry } from './UIRegistry'
import type { IUIRegistry } from './ModuleContext'

describe('UIRegistry', () => {
  it('implements IUIRegistry', () => {
    const r: IUIRegistry = new UIRegistry()
    expect(r).toBeDefined()
  })

  it('registerPanel stores the render fn under its id', () => {
    const r = new UIRegistry()
    const render = () => document.createElement('div')
    r.registerPanel('p1', render)
    expect(r.panels.get('p1')).toBe(render)
  })

  it('registerPanel with duplicate id overwrites (last write wins)', () => {
    const r = new UIRegistry()
    const a = () => document.createElement('div')
    const b = () => document.createElement('span')
    r.registerPanel('p1', a)
    r.registerPanel('p1', b)
    expect(r.panels.get('p1')).toBe(b)
    expect(r.panels.size).toBe(1)
  })

  it('registerMenuItem appends in order', () => {
    const r = new UIRegistry()
    r.registerMenuItem('A', () => {})
    r.registerMenuItem('B', () => {})
    expect(r.menuItems.map((m) => m.label)).toEqual(['A', 'B'])
  })

  it('registerMenuItem stores an optional icon (and leaves it undefined without one)', () => {
    const r = new UIRegistry()
    r.registerMenuItem('Charts', () => {}, 'charts')
    r.registerMenuItem('Plain', () => {})
    expect(r.menuItems[0].icon).toBe('charts')
    expect(r.menuItems[1].icon).toBeUndefined()
  })

  it('registerShortcut appends', () => {
    const r = new UIRegistry()
    r.registerShortcut('Ctrl+P', () => {})
    expect(r.shortcuts).toHaveLength(1)
    expect(r.shortcuts[0].keys).toBe('Ctrl+P')
  })

  it('togglePanel no-ops when no host is set', () => {
    const r = new UIRegistry()
    expect(() => r.togglePanel('anything')).not.toThrow()
  })

  it('togglePanel delegates to the host once set', () => {
    const r = new UIRegistry()
    const host = { toggle: vi.fn() }
    r.setPanelHost(host)
    r.togglePanel('p1')
    expect(host.toggle).toHaveBeenCalledWith('p1')
  })
})
