import { test as base, expect } from '@playwright/test'

// Structural enforcement of the "gate is OFFLINE" guarantee. A
// `page.on('requestfailed')` listener only tells you a request failed at
// the network layer — it says nothing if the request completes with a
// 404/500, and it says nothing at all if the machine running the gate has
// real internet and an unshimmed call simply succeeds. That makes the
// offline guarantee environmental (depends on the runner's network) rather
// than structural (true regardless of the runner).
//
// This fixture makes it structural: every request the page issues is routed
// through a blocklist before it can leave the browser. Anything that is not
// the local e2e dev server, or one of the schemes the page legitimately
// needs internally (data:, blob:, about:), is aborted — it never reaches a
// real network stack, so it can't merely be "unlikely" to succeed, it is
// impossible. Each blocked attempt is recorded, and at teardown the test
// fails with the exact list of URLs that tried to leave — a silently
// swallowed abort would be exactly as weak as no check at all.
//
// Specs opt in with a one-line change: import `test`/`expect` from this
// module instead of '@playwright/test'. The lockdown fixture is `auto:
// true`, so it runs for every test in the file without the test needing to
// destructure or reference it.
const ALLOWED_ORIGIN = 'http://localhost:5199'
const ALLOWED_SCHEMES = ['data:', 'blob:', 'about:']

export const test = base.extend<{ networkLockdown: void }>({
  networkLockdown: [
    async ({ page }, use) => {
      const blocked: string[] = []

      await page.route('**/*', (route) => {
        const url = route.request().url()
        const allowed =
          url.startsWith(ALLOWED_ORIGIN) ||
          ALLOWED_SCHEMES.some((scheme) => url.startsWith(scheme))

        if (allowed) {
          route.continue()
          return
        }

        blocked.push(url)
        route.abort('blockedbyclient')
      })

      await use()

      expect(
        blocked,
        `blocked outbound request(s) to non-local origin(s) — the offline gate caught an attempted network call: ${blocked.join(' | ')}`,
      ).toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
