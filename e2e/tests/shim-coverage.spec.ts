import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// This project is ESM ("type": "module" in package.json), so __dirname isn't
// available inside spec files the way the brief's snippet assumed.
const __dirname = dirname(fileURLToPath(import.meta.url))

// A new `import { something } from '@tauri-apps/...'` in src/ would silently
// become `undefined` under the alias and break e2e in a confusing way. Fail
// loudly here instead.
test('the shim exports every Tauri symbol src/ imports', () => {
  const imported = new Set<string>()

  // NOTE: cannot `import * as shim from '../shim/tauri'` here. That module
  // does `import golden from '../golden/index.json'` with no import
  // attribute; Vite/esbuild tolerate that, but Node's native ESM loader
  // (used when Playwright's test runner loads this spec file directly)
  // rejects it with ERR_IMPORT_ATTRIBUTE_MISSING under Node >=22 strict mode.
  // Reproduced independently of Playwright: `node --input-type=module -e
  // "import('.../e2e/shim/tauri.ts')"` throws the same error. Parse the
  // shim's exported names statically instead of importing the module.
  const shimSource = readFileSync(join(__dirname, '../shim/tauri.ts'), 'utf8')
  const exported = new Set<string>()
  for (const match of shimSource.matchAll(/^export\s+(?:async\s+function|function|const|let)\s+(\w+)/gm)) {
    exported.add(match[1])
  }

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
        const text = readFileSync(path, 'utf8')
        const re = /import\s*\{([^}]+)\}\s*from\s*['"]@tauri-apps\/[^'"]+['"]/g
        for (const match of text.matchAll(re)) {
          for (const name of match[1].split(',')) {
            const clean = name.trim().split(/\s+as\s+/)[0].trim()
            if (clean) imported.add(clean)
          }
        }
      }
    }
  }

  walk(join(__dirname, '../../src'))

  const missing = [...imported].filter((name) => !exported.has(name))

  expect(missing, `add these to e2e/shim/tauri.ts: ${missing.join(', ')}`).toEqual([])
})
