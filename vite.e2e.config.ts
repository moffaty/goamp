import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// The real bundle, with Tauri and analytics swapped out below the app's own
// code. Nothing under src/ changes.
const shim = resolve(__dirname, 'e2e/shim/tauri.ts')

export default defineConfig({
  resolve: {
    alias: {
      '@tauri-apps/api/core': shim,
      '@tauri-apps/api/window': shim,
      '@tauri-apps/api/webviewWindow': shim,
      '@tauri-apps/api/event': shim,
      '@tauri-apps/plugin-dialog': shim,
      '@tauri-apps/plugin-opener': shim,
      '@tauri-apps/plugin-updater': shim,
      '@aptabase/web': resolve(__dirname, 'e2e/shim/analytics.ts'),
    },
  },
  server: { port: 5199, strictPort: true },
  publicDir: resolve(__dirname, 'e2e/fixtures-public'),
})
