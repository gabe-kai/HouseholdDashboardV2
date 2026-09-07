import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8790);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Browser binaries are not part of npm ci. `npm run test:e2e` installs
 * Chromium + WebKit for the locked @playwright/test version before running.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run build && npx tsx tests/e2e/start-server.ts`,
    url: `${baseURL}/api/v1/health`,
    // Always start a dedicated e2e server so a stale process cannot hang the suite.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DB_PATH: "runtime/e2e.sqlite",
      HOUSEHOLD_TIMEZONE: "America/New_York",
      EVAL_LAN_ACCESS: "0",
      NODE_ENV: "production",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Pixel 7"] } },
    { name: "webkit", use: { ...devices["iPhone 13"] } },
  ],
});
