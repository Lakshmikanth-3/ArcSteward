import { defineConfig, devices } from "@playwright/test";

/**
 * playwright.config.ts
 * E2E UI test suite — verifies each page's rendered text/components/buttons
 * against the app's actual copy, against a locally-running dev server.
 * Does not exercise Rooster/Supabase/Sui write paths — those are covered by
 * the offline node:test suite (`npm test`) and live smoke scripts
 * (`npm run rooster:e2e` etc).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Capped, not unlimited -- these all hit one local dev server making real
  // Sui/Supabase network calls per page load; too much parallelism just
  // adds queueing latency against a single Next.js process, not real speedup.
  workers: 4,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Only spin up a local dev server when no external E2E_BASE_URL is given
  // (e.g. the deployed site) — matches the pattern already used for
  // rooster:e2e's live-vs-local flexibility.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
