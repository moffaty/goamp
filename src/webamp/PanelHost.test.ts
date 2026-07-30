import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PanelHost } from './PanelHost'
import { UIRegistry } from '../core/UIRegistry'

describe('PanelHost', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('first toggle mounts the rendered element (visible)', () => {
    const registry = new UIRegistry()
    registry.registerPanel('p1', () => {
      const el = document.createElement('div')
      el.textContent = 'panel-one'
      return el
    })
    const host = new PanelHost(registry)

    host.toggle('p1')

    const container = document.querySelector('.goamp-dynamic-panel[data-panel-id="p1"]') as HTMLElement
    expect(container).not.toBeNull()
    expect(container.textContent).toContain('panel-one')
    expect(container.style.display).not.toBe('none')
  })

  it('second toggle hides, third shows again — render called exactly once', () => {
    const registry = new UIRegistry()
    const render = vi.fn(() => document.createElement('div'))
    registry.registerPanel('p1', render)
    const host = new PanelHost(registry)

    host.toggle('p1')
    const container = document.querySelector('[data-panel-id="p1"]') as HTMLElement
    host.toggle('p1')
    expect(container.style.display).toBe('none')
    host.toggle('p1')
    expect(container.style.display).toBe('')

    expect(render).toHaveBeenCalledTimes(1)
  })

  it('toggle of unknown id does nothing', () => {
    const registry = new UIRegistry()
    const host = new PanelHost(registry)
    expect(() => host.toggle('nope')).not.toThrow()
    expect(document.querySelectorAll('.goamp-dynamic-panel')).toHaveLength(0)
  })

  it('toggling one panel does not affect another', () => {
    const registry = new UIRegistry()
    registry.registerPanel('a', () => document.createElement('div'))
    registry.registerPanel('b', () => document.createElement('div'))
    const host = new PanelHost(registry)

    host.toggle('a')
    host.toggle('b')
    host.toggle('a') // hide a

    const a = document.querySelector('[data-panel-id="a"]') as HTMLElement
    const b = document.querySelector('[data-panel-id="b"]') as HTMLElement
    expect(a.style.display).toBe('none')
    expect(b.style.display).toBe('')
  })

  it('wraps the panel in retro chrome with a prettified titlebar', () => {
    const registry = new UIRegistry()
    registry.registerPanel('p2p-peers', () => {
      const el = document.createElement('div')
      el.textContent = 'body'
      return el
    })
    const host = new PanelHost(registry)
    host.toggle('p2p-peers')

    const title = document.querySelector('.goamp-retro-title') as HTMLElement
    expect(title.textContent).toBe('P2P Peers')
    expect(document.querySelector('[data-panel-id="p2p-peers"]')?.textContent).toContain('body')
  })

  it('the retro close button hides the panel', () => {
    const registry = new UIRegistry()
    registry.registerPanel('p1', () => document.createElement('div'))
    const host = new PanelHost(registry)
    host.toggle('p1')

    const container = document.querySelector('[data-panel-id="p1"]') as HTMLElement
    ;(container.querySelector('.goamp-retro-close') as HTMLButtonElement).click()
    expect(container.style.display).toBe('none')
  })

  it('destroy removes all mounted panels', () => {
    const registry = new UIRegistry()
    registry.registerPanel('a', () => document.createElement('div'))
    const host = new PanelHost(registry)
    host.toggle('a')
    expect(document.querySelectorAll('.goamp-dynamic-panel')).toHaveLength(1)

    host.destroy()
    expect(document.querySelectorAll('.goamp-dynamic-panel')).toHaveLength(0)
  })
})
