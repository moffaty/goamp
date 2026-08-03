import { describe, it, expect, vi } from 'vitest'
import { retroWindow, retroIcon, prettifyPanelId } from './retro'

describe('prettifyPanelId', () => {
  it('title-cases hyphenated ids', () => {
    expect(prettifyPanelId('charts')).toBe('Charts')
    expect(prettifyPanelId('mood_radio')).toBe('Mood Radio')
  })
  it('uppercases known acronyms', () => {
    expect(prettifyPanelId('p2p-peers')).toBe('P2P Peers')
  })
})

describe('retroIcon', () => {
  it('returns svg markup for close', () => {
    expect(retroIcon('close')).toContain('<svg')
  })
  it('returns empty string for unknown icon', () => {
    expect(retroIcon('nope')).toBe('')
  })
  it('has glyphs for the menu-wired names', () => {
    for (const name of ['charts', 'peers', 'folder', 'note']) {
      expect(retroIcon(name)).toContain('<svg')
    }
  })
})

describe('retroWindow', () => {
  it('wraps the body under a titlebar with the given title', () => {
    const body = document.createElement('div')
    body.textContent = 'BODY'
    const win = retroWindow({ title: 'My Panel', onClose: () => {} }, body)

    expect(win.querySelector('.goamp-retro-title')?.textContent).toBe('My Panel')
    expect(win.textContent).toContain('BODY')
  })

  it('close button invokes onClose', () => {
    const onClose = vi.fn()
    const win = retroWindow({ title: 'X', onClose }, document.createElement('div'))
    ;(win.querySelector('.goamp-retro-close') as HTMLButtonElement).click()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a drag reports the final position via onDragEnd', () => {
    const onDragEnd = vi.fn()
    const target = document.createElement('div')
    target.style.cssText = 'position:fixed;left:10px;top:10px;'
    document.body.appendChild(target)
    const win = retroWindow(
      { title: 'X', onClose: () => {}, dragTarget: target, onDragEnd },
      document.createElement('div'),
    )
    target.appendChild(win)
    const bar = win.querySelector('.goamp-retro-titlebar') as HTMLElement

    bar.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 15, clientY: 15 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 215, clientY: 115 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    // jsdom has no layout (getBoundingClientRect ⇒ 0), so grab offset = clientX/Y:
    // final = mouseup client − offset = 215−15 / 115−15.
    expect(onDragEnd).toHaveBeenCalledOnce()
    const [left, top] = onDragEnd.mock.calls[0]
    expect(left).toBe(200)
    expect(top).toBe(100)

    target.remove()
  })
})
