import { describe, it, expect } from 'vitest'
import { LocalKVStorage } from './KVStorage'

describe('LocalKVStorage', () => {
  it('returns null for missing keys', () => {
    const s = new LocalKVStorage('test')
    expect(s.get('missing')).toBeNull()
  })

  it('stores and retrieves a string', () => {
    const s = new LocalKVStorage('test')
    s.set('name', 'goamp')
    expect(s.get('name')).toBe('goamp')
  })

  it('stores and retrieves an object', () => {
    const s = new LocalKVStorage('test')
    s.set('obj', { x: 1, y: 2 })
    expect(s.get('obj')).toEqual({ x: 1, y: 2 })
  })

  it('stores and retrieves a number', () => {
    const s = new LocalKVStorage('test')
    s.set('n', 42)
    expect(s.get<number>('n')).toBe(42)
  })

  it('stores and retrieves a boolean', () => {
    const s = new LocalKVStorage('test')
    s.set('flag', false)
    expect(s.get<boolean>('flag')).toBe(false)
  })

  it('remove deletes the key', () => {
    const s = new LocalKVStorage('test')
    s.set('x', 1)
    s.remove('x')
    expect(s.get('x')).toBeNull()
  })

  it('prefixes are isolated', () => {
    const a = new LocalKVStorage('mod-a')
    const b = new LocalKVStorage('mod-b')
    a.set('key', 'from-a')
    expect(b.get('key')).toBeNull()
  })

  it('returns null for corrupted JSON', () => {
    localStorage.setItem('test:bad', 'not-json{{{')
    const s = new LocalKVStorage('test')
    expect(s.get('bad')).toBeNull()
  })
})
