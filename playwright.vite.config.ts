import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated Vite + API stack for P0-006A deep-link smoke.
 * Not mixed into the production-built e2e webServers (keeps PR/RC fast).
 */
const apiPort = Number(process.env.E2E_VITE_API_PORT ?? 8792);
const vitePort = Number(process.env.E2E_VITE_PORT ?? 5174);
const viteURL = `http://127.0.0.1:${vitePort}`;
const apiURL = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["**/z-p0-006a-vite-deeplink.spec.ts", "**/z-p0-007a-vite-deeplink.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    ...devices["Pixel 7"],
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
        // Point Vite's /api/v1 proxy at this smoke API (vite.config defaults to 8787).
        VITE_API_PROXY_TARGET: apiURL,
      },
    },
  ],
});
