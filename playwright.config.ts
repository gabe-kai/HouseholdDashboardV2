import { defineConfig, devices } from "@playwright/test";

/**
 * Browser binaries are not part of npm ci. `npm run test:e2e` installs
 * Chromium + WebKit for the locked @playwright/test version before running.
 *
 * Each browser project uses an isolated e2e DB/port so claim/enrollment state
 * from Chromium does not leak into WebKit (and vice versa).
 */
const chromiumPort = Number(process.env.E2E_CHROMIUM_PORT ?? 8790);
const chromium008aPort = Number(process.env.E2E_CHROMIUM_008A_PORT ?? 8792);
const webkitPort = Number(process.env.E2E_WEBKIT_PORT ?? 8791);
const chromiumURL = `http://127.0.0.1:${chromiumPort}`;
const chromium008aURL = `http://127.0.0.1:${chromium008aPort}`;
const webkitURL = `http://127.0.0.1:${webkitPort}`;

const E2E_008A_OWNER_SECRET =
  "e2e-installation-owner-secret-with-enough-entropy-0123456789ab";

function serverEnv(port: number, dbPath: string, publicOrigin: string) {
  // Control store pins the active household DB; each e2e server needs its own
  // control file or parallel webServers will adopt the first writer's path.
  const controlPath = dbPath.replace(/\.sqlite$/i, "-control.sqlite");
  return {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_PATH: dbPath,
    INSTALLATION_CONTROL_PATH: controlPath,
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
  // Vite-dev deep-link smoke uses playwright.vite.config.ts (npm run test:e2e:vite).
  testIgnore: [
    "**/z-p0-006a-vite-deeplink.spec.ts",
    "**/z-p0-007a-vite-deeplink.spec.ts",
    "**/z-p0-007c-2-vite-deeplink.spec.ts",
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  globalTimeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: process.env.E2E_SKIP_BUILD
        ? `npx tsx tests/e2e/start-server.ts`
        : `npm run build && npx tsx tests/e2e/start-server.ts`,
      url: `${chromiumURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: serverEnv(chromiumPort, "runtime/e2e-chromium.sqlite", chromiumURL),
    },
    {
      command: process.env.E2E_SKIP_BUILD
        ? `npx tsx tests/e2e/start-server.ts`
        : `npm run build && npx tsx tests/e2e/start-server.ts`,
      url: `${chromium008aURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...serverEnv(
          chromium008aPort,
          "runtime/e2e-chromium-008a.sqlite",
          chromium008aURL,
        ),
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: E2E_008A_OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: "runtime/e2e-chromium-008a-control.sqlite",
      },
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
      testIgnore: ["**/z-p0-008a-*.spec.ts"],
      use: { ...devices["Pixel 7"], baseURL: chromiumURL },
    },
    {
      name: "chromium-008a",
      testMatch: ["**/z-p0-008a-*.spec.ts"],
      use: { ...devices["Pixel 7"], baseURL: chromium008aURL },
    },
    {
      name: "chromium-desktop",
      testMatch: [
        "**/z-p0-006a-calm-experience.spec.ts",
        "**/z-p0-006a-geometry.spec.ts",
        "**/z-p0-006c-geometry.spec.ts",
        "**/z-p0-007a-geometry.spec.ts",
        "**/z-p0-007b-geometry.spec.ts",
        "**/z-p0-007c-1-geometry.spec.ts",
        "**/z-p0-007c-2-geometry.spec.ts",
        "**/z-p0-007c-3a-geometry.spec.ts",
        "**/z-p0-007c-3b-geometry.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: chromiumURL,
      },
    },
    {
      name: "chromium-display",
      testMatch: [
        "**/z-p0-007c-2-geometry.spec.ts",
        "**/z-p0-007c-3a-geometry.spec.ts",
        "**/z-p0-007c-3b-geometry.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 3840, height: 2160 },
        deviceScaleFactor: 1,
        baseURL: chromiumURL,
      },
    },
    {
      name: "webkit",
      testIgnore: ["**/z-p0-008a-*.spec.ts"],
      use: { ...devices["iPhone 13"], baseURL: webkitURL },
    },
  ],
});
