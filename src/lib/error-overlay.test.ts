import { describe, it, expect, beforeEach } from 'vitest'
import { showErrorOverlay, installGlobalErrorHandlers } from './error-overlay'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('showErrorOverlay', () => {
  it('renders an overlay with title and Error message+stack', () => {
    const err = new Error('boom')
    showErrorOverlay('Test failure', err)
    const overlay = document.getElementById('goamp-error-overlay')!
    expect(overlay).not.toBeNull()
    expect(overlay.textContent).toContain('Test failure')
    expect(overlay.textContent).toContain('boom')
  })

  it('renders for non-Error values (strings, objects)', () => {
    showErrorOverlay('Test', 'string failure')
    const overlay = document.getElementById('goamp-error-overlay')!
    expect(overlay.textContent).toContain('string failure')
  })

  it('replaces an existing overlay instead of stacking', () => {
    showErrorOverlay('first', new Error('a'))
    showErrorOverlay('second', new Error('b'))
    const all = document.querySelectorAll('#goamp-error-overlay')
    expect(all.length).toBe(1)
    expect(all[0].textContent).toContain('second')
  })

  it('dismiss button removes the overlay', () => {
    showErrorOverlay('x', new Error('y'))
    const overlay = document.getElementById('goamp-error-overlay')!
    const btn = overlay.querySelector('button')!
    btn.click()
    expect(document.getElementById('goamp-error-overlay')).toBeNull()
  })

  it('has very high z-index so it appears over Webamp', () => {
    showErrorOverlay('x', new Error('y'))
    const overlay = document.getElementById('goamp-error-overlay')!
    expect(parseInt(overlay.style.zIndex, 10)).toBeGreaterThan(1000)
  })
})

describe('installGlobalErrorHandlers', () => {
  it('shows overlay on goamp:module-error custom event', () => {
    installGlobalErrorHandlers()
    window.dispatchEvent(new CustomEvent('goamp:module-error', {
      detail: { module: 'feature "p2p"', error: new Error('node unreachable') },
    }))
    const overlay = document.getElementById('goamp-error-overlay')
    expect(overlay?.textContent).toContain('Module init failed')
    expect(overlay?.textContent).toContain('p2p')
    expect(overlay?.textContent).toContain('node unreachable')
  })
})
