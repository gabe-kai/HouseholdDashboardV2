import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import {
  ROUTE_POLICY_INVENTORY,
  ROUTE_POLICY_KEYS,
  routePolicyKey,
} from "../../src/server/route-policy.js";
import { tempDbPath } from "../helpers/auth-fixture.js";

const temps: string[] = [];

afterEach(() => {
  for (const p of temps.splice(0)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("P0-003 route-policy inventory", () => {
  it("lists unique method+path keys and marks test-only bootstrap explicitly", () => {
    expect(ROUTE_POLICY_INVENTORY.length).toBeGreaterThan(10);
    expect(ROUTE_POLICY_KEYS.size).toBe(ROUTE_POLICY_INVENTORY.length);
    const bootstrap = ROUTE_POLICY_INVENTORY.find(
      (entry) => entry.path === "/api/v1/test/bootstrap-claim",
    );
    expect(bootstrap?.testOnly).toBe(true);
  });

  it("fails when a registered /api/v1 route is missing from the inventory", async () => {
    const dbPath = tempDbPath("hd-routes");
    temps.push(dbPath);
    const registered = new Set<string>();
    const config = loadConfig({
      APP_PROFILE: "test",
      AUTO_SEED: "1",
      DB_PATH: dbPath,
      BACKUP_DIR: path.join(os.tmpdir(), "hd-backups"),
      HOUSEHOLD_TIMEZONE: "America/New_York",
      HOST: "127.0.0.1",
      PORT: "8899",
      PUBLIC_ORIGIN: "http://127.0.0.1:8899",
      NODE_ENV: "test",
    });
    const built = await buildApp(config, {
      onRoute: (routeOptions) => {
        const methods = Array.isArray(routeOptions.method)
          ? routeOptions.method
          : [routeOptions.method];
        for (const method of methods) {
          const upper = String(method).toUpperCase();
          if (upper === "HEAD") continue;
          if (!routeOptions.url?.startsWith("/api/v1")) continue;
          registered.add(routePolicyKey(upper, routeOptions.url));
        }
      },
    });
    try {
      await built.app.ready();
      expect(registered.size).toBeGreaterThan(10);
      for (const key of registered) {
        expect(ROUTE_POLICY_KEYS.has(key), `missing inventory entry for ${key}`).toBe(
          true,
        );
      }
      for (const entry of ROUTE_POLICY_INVENTORY) {
        if (entry.testOnly && config.profile === "hosted") continue;
        const key = routePolicyKey(entry.method, entry.path);
        expect(registered.has(key), `inventory route not registered: ${key}`).toBe(true);
      }
    } finally {
      await built.app.close();
    }
  });
});
