import { defineConfig, devices } from "@playwright/test";

const appPort = 3110;
const fixturePort = 54339;
const baseURL = "http://127.0.0.1:" + appPort;
const channel = process.env.STUDYOS_BROWSER_CHANNEL;
const libraryFunction = process.env.STUDYOS_TEST_LIBRARY_FUNCTION === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: { baseURL, trace: "retain-on-failure", channel },
  webServer: [
    {
      command: "node tests/support/mock-supabase.mjs",
      url: "http://127.0.0.1:" + fixturePort + "/health",
      env: {
        STUDYOS_FIXTURE_PORT: String(fixturePort),
        STUDYOS_TELEGRAM_FIXTURE: "1",
        STUDYOS_FIXTURE_MANUAL_LIBRARY: libraryFunction ? "1" : "0",
      },
      timeout: 60_000,
    },
    {
      command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port " + appPort,
      url: baseURL + "/login",
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + fixturePort,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "studyos-loopback-fixture",
        STUDYOS_AI_PROVIDER: "fixture",
        STUDYOS_ENABLE_AI_FIXTURE: "1",
        STUDYOS_TELEGRAM_FIXTURE: "1",
        SUPABASE_TELEGRAM_SERVICE_KEY: "studyos-loopback-worker",
        TELEGRAM_WEBHOOK_SECRET: "studyos-loopback-webhook",
        ...(libraryFunction ? {
          SUPABASE_WORKER_KEY: "studyos-loopback-worker",
          STUDYOS_LIBRARY_CRON_SECRET: "a".repeat(43),
        } : {}),
      },
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 320, height: 740 } } },
  ],
});
