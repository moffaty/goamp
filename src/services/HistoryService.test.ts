import { describe, it, expect, beforeEach } from 'vitest'
import { HistoryService } from './HistoryService'
import { MockTransport } from './transport'

describe('HistoryService', () => {
  let transport: MockTransport
  let svc: HistoryService

  beforeEach(() => {
    transport = new MockTransport()
    svc = new HistoryService(transport)
  })

  it('resolveTrackId calls resolve_track_id', async () => {
    transport.setResponse('resolve_track_id', 'cid-123')
    const result = await svc.resolveTrackId('local', '/a.mp3', 'A', 'B', 200)
    expect(result).toBe('cid-123')
    expect(transport.lastCall.command).toBe('resolve_track_id')
  })

  it('recordListen calls record_track_listen', async () => {
    transport.setResponse('record_track_listen', undefined)
    await svc.recordListen('cid', 'local', 1000, 200, 150, true, false)
    expect(transport.lastCall.command).toBe('record_track_listen')
  })

  it('setLike calls set_track_like', async () => {
    transport.setResponse('set_track_like', undefined)
    await svc.setLike('cid', true)
    expect(transport.lastCall).toEqual({ command: 'set_track_like', args: { canonicalId: 'cid', liked: true } })
  })

  it('surveyGetPending returns null when none', async () => {
    transport.setResponse('survey_get_pending', null)
    const result = await svc.surveyGetPending()
    expect(result).toBeNull()
  })

  it('surveyRespond calls survey_respond', async () => {
    transport.setResponse('survey_respond', undefined)
    await svc.surveyRespond(1, 'like')
    expect(transport.lastCall).toEqual({ command: 'survey_respond', args: { surveyId: 1, response: 'like' } })
  })
})
