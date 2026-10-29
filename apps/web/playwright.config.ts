import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the key user journeys (spec §3), against a real dev server and Postgres.
 * Needs E2E_DATABASE_URL: an empty database these tests may migrate and seed (never a real one).
 * The server's output goes to e2e/.server.log, where sign-in links appear in development (console mailer).
 */
const PORT = 3123;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Set E2E_DATABASE_URL to an empty Postgres database for the end-to-end tests.");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  // The journeys share one server and one sign-in mailbox (the server log), so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The dev server compiles each route on first use.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: ORIGIN,
    trace: "retain-on-failure",
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `corepack pnpm exec next dev -p ${PORT} -H 127.0.0.1 > e2e/.server.log 2>&1`,
    url: `${ORIGIN}/api/health/live`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: databaseUrl,
      APP_ORIGIN: ORIGIN,
      BETTER_AUTH_SECRET: "e2e-only-secret-used-nowhere-else-000000000000",
      NEXT_TELEMETRY_DISABLED: "1",
      // No mail keys: sign-in links are logged instead of sent.
      GMAIL_USER: "",
      GMAIL_APP_PASSWORD: "",
      RESEND_API_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
    },
  },
});
