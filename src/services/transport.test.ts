import { describe, it, expect } from 'vitest'
import { MockTransport } from './transport'

describe('MockTransport', () => {
  it('records calls and returns set response', async () => {
    const t = new MockTransport()
    t.setResponse('my_cmd', 42)
    const result = await t.call<number>('my_cmd', { x: 1 })
    expect(result).toBe(42)
    expect(t.lastCall).toEqual({ command: 'my_cmd', args: { x: 1 } })
  })

  it('throws when response is an Error', async () => {
    const t = new MockTransport()
    t.setResponse('boom', new Error('oops'))
    await expect(t.call('boom')).rejects.toThrow('oops')
  })

  it('reset clears call history', async () => {
    const t = new MockTransport()
    t.setResponse('cmd', null)
    await t.call('cmd')
    t.reset()
    expect(t.calls).toHaveLength(0)
  })

  it('returns undefined for unset commands', async () => {
    const t = new MockTransport()
    const result = await t.call('unknown')
    expect(result).toBeUndefined()
  })
})
