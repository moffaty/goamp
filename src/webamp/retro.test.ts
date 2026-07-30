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
})
