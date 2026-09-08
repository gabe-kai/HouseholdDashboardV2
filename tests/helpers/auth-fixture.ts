import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "../../src/server/config.js";
import { buildApp } from "../../src/server/app.js";
import type { AppStore, AuthContext } from "../../src/server/store.js";
import type { GrantPreset } from "../../src/shared/schemas.js";

export const IDS = {
  morgan: "22222222-2222-4222-8222-222222222201",
  avery: "22222222-2222-4222-8222-222222222202",
  jordan: "22222222-2222-4222-8222-222222222203",
  casey: "22222222-2222-4222-8222-222222222204",
  taylor: "22222222-2222-4222-8222-222222222205",
  rowan: "22222222-2222-4222-8222-222222222206",
} as const;

export const PASSPHRASE = "unique-passphrase-ok!";

export type ClaimedAuth = {
  token: string;
  csrfSecret: string;
  context: AuthContext;
};

export function tempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
}

export async function claimManager(store: AppStore, loginName?: string): Promise<ClaimedAuth> {
  const bootstrap = store.issueBootstrapClaim();
  return store.claim({
    claimToken: bootstrap.token,
    loginName: loginName ?? `mgr${Date.now().toString(36)}`,
    passphrase: PASSPHRASE,
    displayName: "Morgan Reed",
  });
}

export async function enrollAndClaim(
  store: AppStore,
  manager: AuthContext,
  membershipId: string,
  preset: GrantPreset,
  loginName: string,
  displayName: string,
): Promise<ClaimedAuth> {
  const claim = store.issueEnrollmentClaim(manager, { membershipId, preset });
  return store.claim({
    claimToken: claim.token,
    loginName,
    passphrase: PASSPHRASE,
    displayName,
  });
}

export type HttpHarness = {
  app: FastifyInstance;
  store: AppStore;
  db: Database.Database;
  config: AppConfig;
  dbPath: string;
  origin: string;
  close: () => Promise<void>;
};

export async function createHttpHarness(
  overrides: Record<string, string | undefined> = {},
): Promise<HttpHarness> {
  const dbPath = tempDbPath("hd-http");
  const port = String(8797 + Math.floor(Math.random() * 1000));
  const origin = overrides.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
  const config = loadConfig({
    APP_PROFILE: "test",
    AUTO_SEED: "1",
    DB_PATH: dbPath,
    BACKUP_DIR: path.join(os.tmpdir(), "hd-backups"),
    HOUSEHOLD_TIMEZONE: "America/New_York",
    HOST: "127.0.0.1",
    PORT: port,
    PUBLIC_ORIGIN: origin,
    NODE_ENV: "test",
    ...overrides,
  });
  const built = await buildApp(config);
  return {
    app: built.app,
    store: built.store,
    db: built.db,
    config: built.config,
    dbPath,
    origin: config.publicOrigin!,
    close: async () => {
      await built.app.close();
      try {
        fs.rmSync(dbPath, { force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export type SessionCookies = {
  cookieHeader: string;
  csrfToken: string;
  membershipId: string;
};

export async function httpClaimManager(
  harness: HttpHarness,
  loginName = `mgr.${Date.now().toString(36)}`,
): Promise<SessionCookies> {
  const boot = await harness.app.inject({
    method: "POST",
    url: "/api/v1/test/bootstrap-claim",
  });
  if (boot.statusCode !== 200) {
    throw new Error(`bootstrap failed: ${boot.body}`);
  }
  const { token } = boot.json() as { token: string };
  const claim = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/claim",
    headers: { origin: harness.origin },
    payload: {
      claimToken: token,
      loginName,
      passphrase: PASSPHRASE,
      displayName: "Morgan Reed",
    },
  });
  if (claim.statusCode !== 200) {
    throw new Error(`claim failed: ${claim.body}`);
  }
  return sessionFromResponse(harness, claim);
}

export function sessionFromResponse(
  harness: HttpHarness,
  response: { cookies: Array<{ name: string; value: string }>; json: () => unknown },
): SessionCookies {
  const body = response.json() as {
    csrfToken: string;
    member: { id: string };
  };
  const cookie = response.cookies.find((c) => c.name === harness.config.cookieName);
  if (!cookie) throw new Error("missing session cookie");
  return {
    cookieHeader: `${cookie.name}=${cookie.value}`,
    csrfToken: body.csrfToken,
    membershipId: body.member.id,
  };
}

export function authHeaders(harness: HttpHarness, session: SessionCookies): Record<string, string> {
  return {
    cookie: session.cookieHeader,
    "x-csrf-token": session.csrfToken,
    origin: harness.origin,
  };
}
