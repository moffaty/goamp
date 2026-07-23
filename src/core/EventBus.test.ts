import { describe, it, expect, vi } from 'vitest'
import { EventBus } from './EventBus'

describe('EventBus', () => {
  it('calls subscriber when event is emitted', () => {
    const bus = new EventBus()
    const cb = vi.fn()
    bus.on('test', cb)
    bus.emit('test', 42)
    expect(cb).toHaveBeenCalledWith(42)
  })

  it('supports multiple subscribers on the same event', () => {
    const bus = new EventBus()
    const a = vi.fn(), b = vi.fn()
    bus.on('x', a)
    bus.on('x', b)
    bus.emit('x', 'hello')
    expect(a).toHaveBeenCalledWith('hello')
    expect(b).toHaveBeenCalledWith('hello')
  })

  it('does not call subscribers of other events', () => {
    const bus = new EventBus()
    const cb = vi.fn()
    bus.on('a', cb)
    bus.emit('b', 1)
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribe removes the listener', () => {
    const bus = new EventBus()
    const cb = vi.fn()
    const unsub = bus.on('e', cb)
    unsub()
    bus.emit('e', 99)
    expect(cb).not.toHaveBeenCalled()
  })

  it('unsubscribe does not affect other listeners on the same event', () => {
    const bus = new EventBus()
    const a = vi.fn(), b = vi.fn()
    const unsubA = bus.on('e', a)
    bus.on('e', b)
    unsubA()
    bus.emit('e', 1)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith(1)
  })

  it('emitting to an event with no subscribers does nothing', () => {
    const bus = new EventBus()
    expect(() => bus.emit('ghost', {})).not.toThrow()
  })

  it('supports typed payloads', () => {
    const bus = new EventBus()
    const cb = vi.fn()
    bus.on<{ name: string }>('named', cb)
    bus.emit('named', { name: 'GOAMP' })
    expect(cb).toHaveBeenCalledWith({ name: 'GOAMP' })
  })
})
