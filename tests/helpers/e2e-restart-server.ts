import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function e2eDbPathForPort(port: number): string {
  if (port === 8791) return path.resolve(root, "runtime/e2e-webkit.sqlite");
  if (port === 8792) return path.resolve(root, "runtime/e2e-chromium-008a.sqlite");
  if (port === 8793) return path.resolve(root, "runtime/e2e-webkit-008a.sqlite");
  return path.resolve(root, "runtime/e2e-chromium.sqlite");
}

function restartFlagPathForPort(port: number): string {
  return path.resolve(path.dirname(e2eDbPathForPort(port)), `.e2e-restart-${port}`);
}

function generationPathForPort(port: number): string {
  return path.resolve(path.dirname(e2eDbPathForPort(port)), `.e2e-gen-${port}`);
}

function readGeneration(port: number): number {
  const p = generationPathForPort(port);
  if (!fs.existsSync(p)) return 0;
  return Number(fs.readFileSync(p, "utf8")) || 0;
}

async function waitForGeneration(
  port: number,
  minimum: number,
  timeoutMs = 90_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (readGeneration(port) >= minimum) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `E2E server generation did not reach ${minimum} on port ${port} (have ${readGeneration(port)})`,
  );
}

async function waitForHealth(
  origin: string,
  timeoutMs = 60_000,
): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${origin}/api/v1/health`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `E2E server did not become healthy after rebind at ${origin}: ${String(lastError)}`,
  );
}

/**
 * Ask the Playwright-managed e2e server to close Fastify and re-listen on the
 * same port without exiting the Node process. SQLite (and display sessions)
 * remain on disk. Prefer this over taskkill so the rest of the suite keeps
 * Playwright's webServer child.
 */
function wipeFlagPathForPort(port: number): string {
  return path.resolve(path.dirname(e2eDbPathForPort(port)), `.e2e-wipe-${port}`);
}

export async function restartPreservingE2eServer(baseURL: string): Promise<void> {
  const url = new URL(baseURL);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const origin = url.origin;
  const flagPath = restartFlagPathForPort(port);
  const beforeGen = readGeneration(port);

  await waitForHealth(origin, 30_000);

  fs.mkdirSync(path.dirname(flagPath), { recursive: true });
  fs.writeFileSync(flagPath, `${Date.now()}\n`, "utf8");

  const targetGen = beforeGen + 1;
  try {
    await waitForGeneration(port, targetGen, 90_000);
  } catch {
    // Only re-arm if the generation never advanced; a late bump must not
    // trigger a second rebind while the test is already navigating.
    if (readGeneration(port) < targetGen) {
      fs.writeFileSync(flagPath, `${Date.now()}\n`, "utf8");
      await waitForGeneration(port, targetGen, 120_000);
    }
  }
  await waitForHealth(origin);
}

/** Wipe household DB + control store and rebind (empty installation for the next test). */
export async function wipeAndRebindE2eServer(baseURL: string): Promise<void> {
  const url = new URL(baseURL);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const origin = url.origin;
  const flagPath = wipeFlagPathForPort(port);
  const beforeGen = readGeneration(port);

  const before = await fetch(`${origin}/api/v1/health`);
  if (!before.ok) {
    throw new Error(`E2E server not healthy before wipe (${before.status})`);
  }

  fs.mkdirSync(path.dirname(flagPath), { recursive: true });
  fs.writeFileSync(flagPath, `${Date.now()}\n`, "utf8");

  const started = Date.now();
  let lastMeta: unknown;
  while (Date.now() - started < 90_000) {
    if (readGeneration(port) >= beforeGen + 1) {
      try {
        await waitForHealth(origin, 10_000);
        const meta = await fetch(`${origin}/api/v1/meta`);
        if (meta.ok) {
          const body = (await meta.json()) as {
            setupRequired?: boolean;
            installationEpoch?: number;
          };
          lastMeta = body;
          if (body.setupRequired === true && body.installationEpoch === 1) {
            return;
          }
        }
      } catch {
        /* keep polling */
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `E2E wipe did not yield empty setup on port ${port} (gen ${readGeneration(port)} want >= ${beforeGen + 1}; last meta ${JSON.stringify(lastMeta)})`,
  );
}

export async function disposeRespawnedE2eServers(): Promise<void> {
  // Soft-rebind leaves the Playwright-managed process in place; nothing to kill.
}
