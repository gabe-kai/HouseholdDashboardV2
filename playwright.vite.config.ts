import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated Vite + API stack for deep-link smoke and the P0-009A fictional proof.
 * Not mixed into the production-built e2e webServers (keeps PR/RC fast).
 */
const apiPort = Number(process.env.E2E_VITE_API_PORT ?? 8792);
const vitePort = Number(process.env.E2E_VITE_PORT ?? 5174);
const viteURL = `http://127.0.0.1:${vitePort}`;
const apiURL = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: viteURL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `npx tsx tests/e2e/start-api-only.ts`,
      url: `${apiURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(apiPort),
        VITE_PORT: String(vitePort),
        DB_PATH: "runtime/e2e-vite-api.sqlite",
        HOUSEHOLD_TIMEZONE: "America/New_York",
        EVAL_LAN_ACCESS: "0",
        APP_PROFILE: "test",
        AUTO_SEED: "1",
        PUBLIC_ORIGIN: viteURL,
        NODE_ENV: "development",
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${vitePort} --strictPort`,
      url: viteURL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        VITE_PORT: String(vitePort),
        VITE_API_PROXY_TARGET: apiURL,
      },
    },
  ],
  projects: [
    {
      name: "vite-phone",
      testMatch: [
        "**/z-p0-006a-vite-deeplink.spec.ts",
        "**/z-p0-007a-vite-deeplink.spec.ts",
        "**/z-p0-007c-2-vite-deeplink.spec.ts",
        "**/z-p0-008d-vite-deeplink.spec.ts",
        "**/z-p0-009a-vite-deeplink.spec.ts",
      ],
      use: { ...devices["Pixel 7"], baseURL: viteURL },
    },
    {
      name: "vite-desktop",
      testMatch: ["**/z-p0-009a-proof-vite.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: viteURL,
      },
    },
    {
      name: "vite-touch",
      testMatch: ["**/z-p0-009a-proof-vite.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        hasTouch: true,
        isMobile: false,
        baseURL: viteURL,
      },
    },
  ],
});
