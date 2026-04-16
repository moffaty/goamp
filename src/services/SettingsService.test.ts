import { describe, it, expect, beforeEach } from 'vitest'
import { SettingsService } from './SettingsService'
import { MockTransport } from './transport'
import type { FeatureFlag } from './interfaces'

const flags: FeatureFlag[] = [
  { key: 'recommendations', enabled: true, description: 'Enable recs' },
  { key: 'auto_scrobble', enabled: false, description: 'Auto scrobble' },
]

describe('SettingsService', () => {
  let transport: MockTransport
  let svc: SettingsService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new SettingsService(transport)
  })

  it('refreshFlagCache + isEnabled works', async () => {
    transport.setResponse('feature_flags_list', flags)
    await svc.refreshFlagCache()
    expect(svc.isEnabled('recommendations')).toBe(true)
    expect(svc.isEnabled('auto_scrobble')).toBe(false)
  })

  it('isEnabled returns true for unknown key (default)', () => {
    expect(svc.isEnabled('unknown_key')).toBe(true)
  })

  it('setFlag calls feature_flags_set', async () => {
    transport.setResponse('feature_flags_set', undefined)
    await svc.setFlag('auto_scrobble', true)
    expect(transport.lastCall).toEqual({ command: 'feature_flags_set', args: { key: 'auto_scrobble', enabled: true } })
  })

  it('youtubeSetCookies calls youtube_set_cookies', async () => {
    transport.setResponse('youtube_set_cookies', undefined)
    await svc.youtubeSetCookies('/path/cookies.txt')
    expect(transport.lastCall).toEqual({ command: 'youtube_set_cookies', args: { path: '/path/cookies.txt' } })
  })
})
