import { defineConfig, devices } from "@playwright/test";

/**
 * Browser binaries are not part of npm ci. `npm run test:e2e` installs
 * Chromium + WebKit for the locked @playwright/test version before running.
 *
 * Each browser project uses an isolated e2e DB/port so claim/enrollment state
 * from Chromium does not leak into WebKit (and vice versa).
 */
const chromiumPort = Number(process.env.E2E_CHROMIUM_PORT ?? 8790);
const webkitPort = Number(process.env.E2E_WEBKIT_PORT ?? 8791);
const chromiumURL = `http://127.0.0.1:${chromiumPort}`;
const webkitURL = `http://127.0.0.1:${webkitPort}`;

function serverEnv(port: number, dbPath: string, publicOrigin: string) {
  return {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_PATH: dbPath,
    HOUSEHOLD_TIMEZONE: "America/New_York",
    EVAL_LAN_ACCESS: "0",
    NODE_ENV: "production",
    APP_PROFILE: "test",
    AUTO_SEED: "1",
    PUBLIC_ORIGIN: publicOrigin,
  };
}

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
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `npm run build && npx tsx tests/e2e/start-server.ts`,
      url: `${chromiumURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: serverEnv(chromiumPort, "runtime/e2e-chromium.sqlite", chromiumURL),
    },
    {
      command: `npx tsx tests/e2e/start-server.ts`,
      url: `${webkitURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: serverEnv(webkitPort, "runtime/e2e-webkit.sqlite", webkitURL),
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Pixel 7"], baseURL: chromiumURL },
    },
    {
      name: "webkit",
      use: { ...devices["iPhone 13"], baseURL: webkitURL },
    },
  ],
});
