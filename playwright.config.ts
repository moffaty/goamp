import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/artifacts/test-output',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list'], ['html', { outputFolder: 'e2e/artifacts/report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Without this, headless Chromium refuses to start playback and the
      // local-file scenario cannot advance.
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    // `pnpm` is not a bare command on PATH in this environment; invoke the
    // local binary directly instead of `pnpm exec vite ...`.
    command: 'node_modules/.bin/vite --config vite.e2e.config.ts',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
