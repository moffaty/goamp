import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('vite.config.ts', () => {
  const src = readFileSync(resolve(__dirname, '..', 'vite.config.ts'), 'utf8')

  it('sets build.target to esnext so top-level await is allowed in Tauri', () => {
    expect(src).toContain("target: 'esnext'")
  })
})
