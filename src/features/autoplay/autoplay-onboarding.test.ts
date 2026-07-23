import { describe, it, expect, beforeEach } from 'vitest'
import { showOnboardingOnce, dismissOnboarding, isOnboarded } from './autoplay-onboarding'

const OVERLAY = 'goamp-autoplay-onboarding'

beforeEach(() => {
  localStorage.clear()
  document.getElementById(OVERLAY)?.remove()
})

describe('autoplay onboarding', () => {
  it('is NOT onboarded by default', () => {
    expect(isOnboarded()).toBe(false)
  })

  it('showOnboardingOnce renders the card the first time', () => {
    showOnboardingOnce()
    expect(document.getElementById(OVERLAY)).not.toBeNull()
  })

  it('mentions the L / D / N hotkeys', () => {
    showOnboardingOnce()
    const text = document.getElementById(OVERLAY)?.textContent ?? ''
    expect(text).toContain('like')
    expect(text).toContain('dislike')
    expect(text).toContain('normal')
  })

  it('does NOT render again after the user has been onboarded', () => {
    showOnboardingOnce()
    dismissOnboarding()
    expect(document.getElementById(OVERLAY)).toBeNull()
    showOnboardingOnce()
    expect(document.getElementById(OVERLAY)).toBeNull()
  })

  it('dismissOnboarding sets the persistent flag', () => {
    showOnboardingOnce()
    dismissOnboarding()
    expect(isOnboarded()).toBe(true)
    expect(localStorage.getItem('autoplay:onboarded')).toBe('1')
  })

  it('clicking the "Got it" button dismisses', () => {
    showOnboardingOnce()
    const btn = document.querySelector(`#${OVERLAY} button`) as HTMLButtonElement
    btn.click()
    expect(isOnboarded()).toBe(true)
    expect(document.getElementById(OVERLAY)).toBeNull()
  })
})
