import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running web app (:3000) backed by the mock API (:4000).
 * CI starts both (.github/workflows/ci.yml); locally run `pnpm dev` first, then `pnpm --filter @divvy/web e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
