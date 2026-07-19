import { defineConfig, devices } from "@playwright/test";

// E2E tests need a running app pointed at a Supabase project that has been
// migrated and seeded (see TESTING.md). Test auth is enabled via
// ALLOW_TEST_AUTH=1, which the app refuses in production builds.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        env: { ALLOW_TEST_AUTH: "1" },
        timeout: 120_000,
      },
});
