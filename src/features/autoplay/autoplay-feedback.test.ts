import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  blockTrack, likeTrack, markNormal, isBlocked, isLiked, isNormalMarked, isRated,
  feedbackKey, recordTrackSignal, __resetFeedback,
} from './autoplay-feedback'

beforeEach(() => {
  localStorage.clear()
  __resetFeedback()
  vi.mocked(invoke).mockReset()
})

describe('feedbackKey', () => {
  it('lowercases and trims', () => {
    expect(feedbackKey('  TWENTY One Pilots  ', ' Routines ')).toBe('twenty one pilots|routines')
  })
})

describe('block / like', () => {
  it('blockTrack marks a track as blocked', () => {
    blockTrack('Daft Punk', 'One More Time')
    expect(isBlocked('Daft Punk', 'One More Time')).toBe(true)
    expect(isBlocked('Daft Punk', 'Other Song')).toBe(false)
  })

  it('likeTrack marks a track as liked', () => {
    likeTrack('Daft Punk', 'One More Time')
    expect(isLiked('Daft Punk', 'One More Time')).toBe(true)
  })

  it('block then like flips the state (mutually exclusive)', () => {
    blockTrack('Daft Punk', 'One More Time')
    expect(isBlocked('Daft Punk', 'One More Time')).toBe(true)
    likeTrack('Daft Punk', 'One More Time')
    expect(isLiked('Daft Punk', 'One More Time')).toBe(true)
    expect(isBlocked('Daft Punk', 'One More Time')).toBe(false)
  })

  it('like then block flips back', () => {
    likeTrack('Daft Punk', 'One More Time')
    blockTrack('Daft Punk', 'One More Time')
    expect(isBlocked('Daft Punk', 'One More Time')).toBe(true)
    expect(isLiked('Daft Punk', 'One More Time')).toBe(false)
  })

  it('survives a reload (persisted in localStorage)', () => {
    blockTrack('A', 'B')
    likeTrack('C', 'D')
    __resetFeedback() // simulate fresh module load
    expect(isBlocked('A', 'B')).toBe(true)
    expect(isLiked('C', 'D')).toBe(true)
  })

  it('ignores empty input', () => {
    blockTrack('', '')
    expect(isBlocked('', '')).toBe(false)
  })
})

describe('markNormal / isRated', () => {
  it('markNormal marks a track as rated without liking or blocking it', () => {
    markNormal('A', 'B')
    expect(isNormalMarked('A', 'B')).toBe(true)
    expect(isLiked('A', 'B')).toBe(false)
    expect(isBlocked('A', 'B')).toBe(false)
    expect(isRated('A', 'B')).toBe(true)
  })

  it('isRated is true for liked, blocked, OR normal', () => {
    likeTrack('A', '1')
    blockTrack('B', '2')
    markNormal('C', '3')
    expect(isRated('A', '1')).toBe(true)
    expect(isRated('B', '2')).toBe(true)
    expect(isRated('C', '3')).toBe(true)
    expect(isRated('D', '4')).toBe(false)
  })

  it('the three sets are mutually exclusive', () => {
    likeTrack('A', 'B')
    markNormal('A', 'B')
    expect(isLiked('A', 'B')).toBe(false)
    expect(isNormalMarked('A', 'B')).toBe(true)
    blockTrack('A', 'B')
    expect(isNormalMarked('A', 'B')).toBe(false)
    expect(isBlocked('A', 'B')).toBe(true)
    markNormal('A', 'B')
    expect(isBlocked('A', 'B')).toBe(false)
    expect(isNormalMarked('A', 'B')).toBe(true)
  })

  it('normal state survives a reload', () => {
    markNormal('A', 'B')
    __resetFeedback()
    expect(isNormalMarked('A', 'B')).toBe(true)
    expect(isRated('A', 'B')).toBe(true)
  })
})

describe('recordTrackSignal (backend bridge)', () => {
  it('resolves the canonical id and records the signal', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('hash_abc') // resolve_track_id
    vi.mocked(invoke).mockResolvedValueOnce(undefined) // record_track_signal

    await recordTrackSignal(
      { artist: 'Daft Punk', title: 'One More Time', source: 'youtube', sourceId: 'vid1', duration: 320 },
      -1,
    )

    expect(invoke).toHaveBeenNthCalledWith(1, 'resolve_track_id', {
      source: 'youtube', sourceId: 'vid1', artist: 'Daft Punk', title: 'One More Time', duration: 320,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'record_track_signal', {
      canonicalId: 'hash_abc', signal: -1, scope: 'global',
    })
  })

  it('extracts the videoId from a goampaudio URL before resolving', async () => {
    vi.mocked(invoke).mockResolvedValue('hash')
    await recordTrackSignal(
      {
        artist: 'A', title: 'B', source: 'youtube',
        sourceId: 'http://goampaudio.localhost/dQw4w9WgXcQ',
      },
      +1,
    )
    const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'resolve_track_id')
    expect((call?.[1] as { sourceId: string }).sourceId).toBe('dQw4w9WgXcQ')
  })

  it('swallows backend failure (best-effort)', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('no backend'))
    await expect(recordTrackSignal({ artist: 'A', title: 'B' }, -1)).resolves.toBeUndefined()
  })

  it('does nothing for an empty track', async () => {
    vi.mocked(invoke).mockClear()
    await recordTrackSignal({ artist: '', title: '' }, -1)
    expect(invoke).not.toHaveBeenCalled()
  })
})
