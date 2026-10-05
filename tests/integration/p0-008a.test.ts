import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type BuildAppOptions } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { migrate } from "../../src/server/db.js";
import {
  createHttpHarness,
  tempDbPath,
  type HttpHarness,
} from "../helpers/auth-fixture.js";
import {
  openPopulatedP017UpgradeDatabase,
  P017_FIXTURE_IDS,
} from "../helpers/p017-fixture.js";

const OWNER_SECRET = "test-owner-secret-with-enough-entropy-0123456789abcdef";
const OWNER_SECRET_B = "rotated-owner-secret-with-enough-entropy-0123456789ab";
const PASSPHRASE = "Unique-passphrase-ok!999";
const harnesses: HttpHarness[] = [];
const temps: string[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    await harnesses.pop()?.close();
  }
  for (const file of temps.splice(0)) {
    try {
      fs.rmSync(file, { force: true, recursive: true });
    } catch {
      /* ignore */
    }
  }
});

function controlPathForTest(): string {
  const p = path.join(
    os.tmpdir(),
    `hd-control-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(p);
  return p;
}

function backupDirForTest(): string {
  const dir = path.join(
    os.tmpdir(),
    `hd-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  temps.push(dir);
  return dir;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function countOf(db: { prepare: (sql: string) => { get: () => unknown } }, sql: string): number {
  return (db.prepare(sql).get() as { c: number }).c;
}

function snapshotPopulatedCounts(db: {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
}) {
  return {
    households: countOf(db, "SELECT COUNT(*) AS c FROM households"),
    memberships: countOf(db, "SELECT COUNT(*) AS c FROM household_memberships"),
    users: countOf(db, "SELECT COUNT(*) AS c FROM users"),
    grants: countOf(db, "SELECT COUNT(*) AS c FROM membership_grants"),
    displays: countOf(db, "SELECT COUNT(*) AS c FROM household_displays"),
    personalTasks: countOf(db, "SELECT COUNT(*) AS c FROM personal_tasks"),
    plans: countOf(db, "SELECT COUNT(*) AS c FROM routine_definitions"),
    lockedOccurrences: countOf(
      db,
      "SELECT COUNT(*) AS c FROM occurrences WHERE started_at IS NOT NULL",
    ),
    historyReports: countOf(db, "SELECT COUNT(*) AS c FROM step_reports"),
    householdId: (
      db.prepare("SELECT id FROM households LIMIT 1").get() as { id: string } | undefined
    )?.id,
    morganGrants: (
      db
        .prepare(
          `SELECT grant_name FROM membership_grants
           WHERE membership_id = ? ORDER BY grant_name`,
        )
        .all(P017_FIXTURE_IDS.morganId) as Array<{ grant_name: string }>
    ).map((r) => r.grant_name),
  };
}

async function ownerSession(
  harness: HttpHarness,
  secret = OWNER_SECRET,
): Promise<{ cookie: string; csrf: string }> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/owner/session",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { secret },
  });
  expect(res.statusCode).toBe(200);
  const csrf = (res.json() as { csrfToken: string }).csrfToken;
  const cookie = res.cookies.find((c) => c.name === harness.config.ownerCookieName)!;
  return { cookie: `${cookie.name}=${cookie.value}`, csrf };
}

async function issueSetupInvitation(harness: HttpHarness, owner: { cookie: string; csrf: string }) {
  const invite = await harness.app.inject({
    method: "POST",
    url: "/api/v1/owner/setup-invitation",
    headers: {
      origin: harness.origin,
      cookie: owner.cookie,
      "x-csrf-token": owner.csrf,
    },
  });
  expect(invite.statusCode).toBe(200);
  return (invite.json() as { invitationToken: string }).invitationToken;
}

async function exchangeSetup(
  harness: HttpHarness,
  invitationToken: string,
): Promise<{ cookie: string; csrf: string }> {
  const exchanged = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/exchange",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { invitationToken },
  });
  expect(exchanged.statusCode).toBe(200);
  const setupCookie = exchanged.cookies.find((c) => c.name === harness.config.setupCookieName)!;
  const csrf = (exchanged.json() as { csrfToken: string }).csrfToken;
  return { cookie: `${setupCookie.name}=${setupCookie.value}`, csrf };
}

async function createSetupAccount(
  harness: HttpHarness,
  setupCookie: string,
  loginName: string,
  displayName = "Taylor Manager",
) {
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/account",
    headers: {
      origin: harness.origin,
      cookie: setupCookie,
      "content-type": "application/json",
    },
    payload: {
      loginName,
      passphrase: PASSPHRASE,
      displayName,
    },
  });
}

async function completeHousehold(
  harness: HttpHarness,
  memberCookie: string,
  csrf: string,
  name: string,
) {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/household",
    headers: {
      origin: harness.origin,
      cookie: memberCookie,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    payload: { name, timezone: "America/New_York" },
  });
  expect(res.statusCode).toBe(200);
  return res;
}

async function setupManagerHousehold(
  harness: HttpHarness,
  loginName: string,
  householdName: string,
): Promise<{ cookie: string; csrf: string; membershipId: string }> {
  const owner = await ownerSession(harness);
  const token = await issueSetupInvitation(harness, owner);
  const setup = await exchangeSetup(harness, token);
  const account = await createSetupAccount(harness, setup.cookie, loginName);
  expect(account.statusCode).toBe(200);
  const memberCookie = account.cookies.find((c) => c.name === harness.config.cookieName)!;
  const csrf = (account.json() as { csrfToken: string }).csrfToken;
  const membershipId = (account.json() as { member: { id: string } }).member.id;
  const cookie = `${memberCookie.name}=${memberCookie.value}`;
  await completeHousehold(harness, cookie, csrf, householdName);
  return { cookie, csrf, membershipId };
}

async function reauthAndReset(
  harness: HttpHarness,
  session: { cookie: string; csrf: string },
  expectedEpoch: number,
  mutationId = randomUUID(),
) {
  const reauth = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/reauthenticate",
    headers: {
      origin: harness.origin,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
      "content-type": "application/json",
    },
    payload: { passphrase: PASSPHRASE },
  });
  expect(reauth.statusCode).toBe(200);
  return harness.app.inject({
    method: "POST",
    url: "/api/v1/household/reset",
    headers: {
      origin: harness.origin,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
      "content-type": "application/json",
    },
    payload: {
      mutationId,
      confirmationText: "RESET",
      expectedEpoch,
    },
  });
}

function trackHarness(harness: HttpHarness): HttpHarness {
  harnesses.push(harness);
  return harness;
}

async function reopenHarness(
  previous: HttpHarness,
  overrides: Record<string, string | undefined> = {},
  buildOptions?: BuildAppOptions,
): Promise<HttpHarness> {
  const activeDbPath = previous.runtime.activeDbPath;
  const controlPath = previous.config.installationControlPath;
  const origin = previous.origin;
  const backupDir = previous.config.backupDir;
  const ownerSecret =
    overrides.INSTALLATION_OWNER_SECRET ??
    previous.config.installationOwnerSecret ??
    OWNER_SECRET;
  await previous.app.close();
  // Drop closed harness from cleanup list; reopened handle owns cleanup.
  const idx = harnesses.indexOf(previous);
  if (idx >= 0) harnesses.splice(idx, 1);

  const config = loadConfig({
    APP_PROFILE: "test",
    AUTO_SEED: "0",
    DB_PATH: activeDbPath,
    BACKUP_DIR: backupDir,
    HOUSEHOLD_TIMEZONE: "America/New_York",
    HOST: "127.0.0.1",
    PORT: String(8797 + Math.floor(Math.random() * 1000)),
    PUBLIC_ORIGIN: origin,
    NODE_ENV: "test",
    INSTALLATION_OWNER_SECRET: ownerSecret ?? undefined,
    INSTALLATION_CONTROL_PATH: controlPath,
    ...overrides,
  });
  const built = await buildApp(config, buildOptions);
  const next: HttpHarness = {
    app: built.app,
    store: built.store,
    db: built.db,
    config: built.config,
    dbPath: activeDbPath,
    origin,
    runtime: built.runtime,
    close: async () => {
      const active = built.runtime.activeDbPath;
      await built.app.close();
      for (const target of [activeDbPath, active, controlPath]) {
        for (const file of [target, `${target}-wal`, `${target}-shm`]) {
          try {
            fs.rmSync(file, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    },
  };
  return trackHarness(next);
}

async function enrollDisplay(
  harness: HttpHarness,
  manager: { cookie: string; csrf: string },
): Promise<{ displayCookie: string }> {
  const createRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/displays",
    headers: {
      cookie: manager.cookie,
      origin: harness.origin,
      "x-csrf-token": manager.csrf,
      "content-type": "application/json",
    },
    payload: { mutationId: randomUUID(), label: "008A wall" },
  });
  expect(createRes.statusCode).toBe(200);
  const created = createRes.json() as { enrollment: { code: string } };
  const claimRes = await harness.app.inject({
    method: "POST",
    url: "/api/v1/display/claim",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { code: created.enrollment.code },
  });
  expect(claimRes.statusCode).toBe(200);
  const displayCookie = claimRes.cookies.find(
    (c) => c.name === harness.config.displayCookieName,
  );
  expect(displayCookie?.value).toBeTruthy();
  return { displayCookie: `${displayCookie!.name}=${displayCookie!.value}` };
}

describe("P0-008A AT1 populated through-017 adoption", () => {
  it("AT1 populated through-017: upgrade twice preserves identities/grants/data and backup bytes", async () => {
    const dbPath = tempDbPath("hd-p017");
    temps.push(dbPath);
    const db = openPopulatedP017UpgradeDatabase(dbPath);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '018_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '017_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);

    const before = snapshotPopulatedCounts(db);
    expect(before.households).toBe(1);
    expect(before.memberships).toBeGreaterThan(0);
    expect(before.users).toBeGreaterThan(0);
    expect(before.grants).toBeGreaterThan(0);
    expect(before.displays).toBeGreaterThan(0);
    expect(before.personalTasks).toBeGreaterThan(0);
    expect(before.plans).toBeGreaterThan(0);
    expect(before.lockedOccurrences).toBeGreaterThan(0);
    expect(before.historyReports).toBeGreaterThan(0);
    db.close();

    const backupDir = backupDirForTest();
    const backupPath = path.join(backupDir, "pre-existing-operator-backup.sqlite");
    fs.copyFileSync(dbPath, backupPath);
    const backupLen = fs.statSync(backupPath).size;
    const backupHash = hashFile(backupPath);

    const controlPath = controlPathForTest();
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPath,
        DB_PATH: dbPath,
        BACKUP_DIR: backupDir,
      }),
    );

    migrate(harness.db);
    migrate(harness.db);
    expect(
      (harness.db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number })
        .c,
    ).toBe(18);

    const after = snapshotPopulatedCounts(harness.db);
    expect(after.households).toBe(before.households);
    expect(after.memberships).toBe(before.memberships);
    expect(after.users).toBe(before.users);
    expect(after.displays).toBe(before.displays);
    expect(after.personalTasks).toBe(before.personalTasks);
    expect(after.plans).toBe(before.plans);
    expect(after.lockedOccurrences).toBe(before.lockedOccurrences);
    expect(after.historyReports).toBe(before.historyReports);
    expect(after.householdId).toBe(before.householdId);
    expect(after.householdId).toBe(P017_FIXTURE_IDS.householdId);

    // 018 backfills lifecycle.manage onto Manager-shaped memberships.
    const lifecycleGrant = harness.db
      .prepare(
        `SELECT 1 AS ok FROM membership_grants
         WHERE membership_id = ? AND grant_name = 'household.lifecycle.manage'`,
      )
      .get(P017_FIXTURE_IDS.morganId) as { ok: number } | undefined;
    expect(lifecycleGrant?.ok).toBe(1);
    expect(after.grants).toBeGreaterThanOrEqual(before.grants);

    expect(fs.statSync(backupPath).size).toBe(backupLen);
    expect(hashFile(backupPath)).toBe(backupHash);

    // ensureAdopt is replay-safe: reopen control adoption does not wipe household data.
    const epochBefore = harness.runtime.epoch;
    const adopted = harness.runtime.control.ensureAdopt(
      harness.runtime.activeDbRelativePath,
    );
    expect(adopted.datasetEpoch).toBe(epochBefore);
    expect(
      (harness.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number }).c,
    ).toBe(1);
    expect(
      (
        harness.db
          .prepare("SELECT id FROM households WHERE id = ?")
          .get(P017_FIXTURE_IDS.householdId) as { id: string } | undefined
      )?.id,
    ).toBe(P017_FIXTURE_IDS.householdId);
  });

  it("AT1 multi-household refuse: reset blocked when more than one household exists", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
      }),
    );
    harness.runtime.db
      .prepare(`INSERT INTO households (id, name, timezone) VALUES (?, 'One', 'UTC'), (?, 'Two', 'UTC')`)
      .run(randomUUID(), randomUUID());
    const count = harness.runtime.db
      .prepare("SELECT COUNT(*) AS c FROM households")
      .get() as { c: number };
    expect(count.c).toBe(2);
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId: randomUUID(),
        sourceEpoch: harness.runtime.epoch,
      }),
    ).rejects.toThrow(/Multiple households/i);
    expect(
      (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number })
        .c,
    ).toBe(2);
  });
});

describe("P0-008A AT2/AT6 owner gate and recovery", () => {
  it("AT2 missing INSTALLATION_OWNER_SECRET makes setup unavailable (403)", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: undefined,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
      }),
    );
    const session = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    expect(session.statusCode).toBe(403);
    const exchange = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken: "not-a-real-token" },
    });
    expect(exchange.statusCode).toBe(403);
    const bootstrap = await harness.app.inject({
      method: "POST",
      url: "/api/v1/test/bootstrap-claim",
    });
    // Without owner secret, bootstrap remains available for ordinary local use.
    expect([200, 403]).toContain(bootstrap.statusCode);
  });

  it("AT2 wrong secret throttles to 429 after repeated failures", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
      }),
    );
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const bad = await harness.app.inject({
        method: "POST",
        url: "/api/v1/owner/session",
        headers: { origin: harness.origin, "content-type": "application/json" },
        payload: { secret: "wrong-secret-value" },
      });
      statuses.push(bad.statusCode);
    }
    expect(statuses.slice(0, 3).every((s) => s === 401)).toBe(true);
    expect(statuses.some((s) => s === 429)).toBe(true);
  });

  it("AT2 owner gate rejects wrong secret and foreign origin", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
      }),
    );
    const badSecret = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: "wrong" },
    });
    expect(badSecret.statusCode).toBe(401);
    const noOrigin = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    expect(noOrigin.statusCode).toBe(403);
    const bootstrap = await harness.app.inject({
      method: "POST",
      url: "/api/v1/test/bootstrap-claim",
    });
    expect(bootstrap.statusCode).toBe(403);
  });

  it("AT2/AT6 setup invitation replay fails; replacement invite works", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
      }),
    );
    const owner = await ownerSession(harness);
    const firstToken = await issueSetupInvitation(harness, owner);
    const firstExchange = await exchangeSetup(harness, firstToken);
    expect(firstExchange.cookie).toContain(harness.config.setupCookieName);

    const replay = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken: firstToken },
    });
    expect(replay.statusCode).toBe(401);

    const replacement = await issueSetupInvitation(harness, owner);
    expect(replacement).not.toBe(firstToken);
    const replacedExchange = await exchangeSetup(harness, replacement);
    expect(replacedExchange.cookie).toContain(harness.config.setupCookieName);

    const staleAfterReplace = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken: firstToken },
    });
    expect(staleAfterReplace.statusCode).toBe(401);
  });

  it("AT2 mixed principal denial: display/member cookies cannot use owner routes", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const manager = await setupManagerHousehold(
      harness,
      `mix.${Date.now().toString(36)}`,
      "Mixed Principal HH",
    );
    const display = await enrollDisplay(harness, manager);

    const withDisplay = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/setup-invitation",
      headers: {
        origin: harness.origin,
        cookie: display.displayCookie,
        "x-csrf-token": "not-an-owner-csrf",
      },
    });
    expect(withDisplay.statusCode).toBe(401);

    const withMember = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/setup-invitation",
      headers: {
        origin: harness.origin,
        cookie: manager.cookie,
        "x-csrf-token": manager.csrf,
      },
    });
    expect(withMember.statusCode).toBe(401);
  });

  it("AT6 secret rotation invalidates prior owner session and invitation", async () => {
    const controlPath = controlPathForTest();
    const backupDir = backupDirForTest();
    let harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPath,
        BACKUP_DIR: backupDir,
      }),
    );
    const owner = await ownerSession(harness, OWNER_SECRET);
    const inviteToken = await issueSetupInvitation(harness, owner);

    harness = await reopenHarness(harness, {
      INSTALLATION_OWNER_SECRET: OWNER_SECRET_B,
      INSTALLATION_CONTROL_PATH: controlPath,
      BACKUP_DIR: backupDir,
    });

    const oldSession = await harness.app.inject({
      method: "GET",
      url: "/api/v1/owner/session",
      headers: { cookie: owner.cookie },
    });
    expect(oldSession.statusCode).toBe(401);

    const oldInvite = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken: inviteToken },
    });
    expect(oldInvite.statusCode).toBe(401);

    const newOwner = await ownerSession(harness, OWNER_SECRET_B);
    const newInvite = await issueSetupInvitation(harness, newOwner);
    await exchangeSetup(harness, newInvite);
  });

  it("AT6 sole-manager password recovery preserves membership id/grants/data", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const loginName = `sole.${Date.now().toString(36)}`;
    const manager = await setupManagerHousehold(harness, loginName, "Recover HH");
    const membershipId = manager.membershipId;
    const grantsBefore = (
      harness.db
        .prepare(
          `SELECT grant_name FROM membership_grants WHERE membership_id = ? ORDER BY grant_name`,
        )
        .all(membershipId) as Array<{ grant_name: string }>
    ).map((r) => r.grant_name);
    const householdId = (
      harness.db.prepare("SELECT id FROM households LIMIT 1").get() as { id: string }
    ).id;
    harness.runtime.db
      .prepare(
        `INSERT INTO personal_tasks
           (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Keep me', 'private', 'open', ?, ?)`,
      )
      .run(randomUUID(), householdId, membershipId, new Date().toISOString(), new Date().toISOString());

    const owner = await ownerSession(harness);
    const recover = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/recover-manager-password",
      headers: {
        origin: harness.origin,
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
        "content-type": "application/json",
      },
      payload: {
        loginName,
        newPassphrase: "Recovered-passphrase-ok!999",
      },
    });
    expect(recover.statusCode).toBe(200);
    expect((recover.json() as { membershipId: string }).membershipId).toBe(membershipId);

    const grantsAfter = (
      harness.db
        .prepare(
          `SELECT grant_name FROM membership_grants WHERE membership_id = ? ORDER BY grant_name`,
        )
        .all(membershipId) as Array<{ grant_name: string }>
    ).map((r) => r.grant_name);
    expect(grantsAfter).toEqual(grantsBefore);
    expect(
      (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM personal_tasks").get() as { c: number })
        .c,
    ).toBe(1);

    const loginOld = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { loginName, passphrase: PASSPHRASE },
    });
    expect(loginOld.statusCode).toBe(401);

    const loginNew = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { loginName, passphrase: "Recovered-passphrase-ok!999" },
    });
    expect(loginNew.statusCode).toBe(200);
    expect((loginNew.json() as { member: { id: string } }).member.id).toBe(membershipId);
  });

  it("AT6 establish-manager on household with no active manager retains household id/data", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const manager = await setupManagerHousehold(
      harness,
      `est.${Date.now().toString(36)}`,
      "Retained HH",
    );
    const householdId = (
      harness.runtime.db.prepare("SELECT id FROM households LIMIT 1").get() as { id: string }
    ).id;
    const taskId = randomUUID();
    harness.runtime.db
      .prepare(
        `INSERT INTO personal_tasks
           (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Retained chore', 'household', 'open', ?, ?)`,
      )
      .run(taskId, householdId, manager.membershipId, new Date().toISOString(), new Date().toISOString());

    // Membership status is only pending|active; disable the user to remove viable manager.
    harness.runtime.db
      .prepare(
        `UPDATE users SET disabled = 1
         WHERE id = (SELECT user_id FROM household_memberships WHERE id = ?)`,
      )
      .run(manager.membershipId);
    expect(harness.runtime.store.hasActiveLifecycleManager()).toBe(false);

    const owner = await ownerSession(harness);
    const established = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/establish-manager",
      headers: {
        origin: harness.origin,
        cookie: owner.cookie,
        "x-csrf-token": owner.csrf,
        "content-type": "application/json",
      },
      payload: {
        loginName: `newmgr.${Date.now().toString(36)}`,
        passphrase: PASSPHRASE,
        displayName: "Replacement Manager",
      },
    });
    expect(established.statusCode).toBe(200);
    expect(
      (harness.runtime.db.prepare("SELECT id FROM households LIMIT 1").get() as { id: string }).id,
    ).toBe(householdId);
    expect(
      (
        harness.runtime.db
          .prepare("SELECT title FROM personal_tasks WHERE id = ?")
          .get(taskId) as { title: string } | undefined
      )?.title,
    ).toBe("Retained chore");
    expect(harness.runtime.store.hasActiveLifecycleManager()).toBe(true);
  });
});

describe("P0-008A AT3 concurrent first-account race", () => {
  it("AT3 concurrent race: two setup invitations/sessions yield one manager", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
      }),
    );
    const owner = await ownerSession(harness);
    const inviteA = await issueSetupInvitation(harness, owner);
    const setupA = await exchangeSetup(harness, inviteA);
    const inviteB = await issueSetupInvitation(harness, owner);
    const setupB = await exchangeSetup(harness, inviteB);

    const [resA, resB] = await Promise.all([
      createSetupAccount(harness, setupA.cookie, `racea.${Date.now().toString(36)}`, "Racer A"),
      createSetupAccount(harness, setupB.cookie, `raceb.${Date.now().toString(36)}`, "Racer B"),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const managers = harness.db
      .prepare(
        `SELECT COUNT(DISTINCT hm.id) AS c
         FROM household_memberships hm
         JOIN membership_grants mg ON mg.membership_id = hm.id
         WHERE hm.status = 'active' AND mg.grant_name = 'household.lifecycle.manage'`,
      )
      .get() as { c: number };
    expect(managers.c).toBe(1);
    expect(
      (harness.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number }).c,
    ).toBe(1);
  });
});

describe("P0-008A AT7 reset without backup", () => {
  it("AT7 two resets: no new backup files; pre-seeded backup bytes unchanged; epoch advances", async () => {
    const backupDir = backupDirForTest();
    const seededBackup = path.join(backupDir, "operator-saved.sqlite");
    fs.writeFileSync(seededBackup, Buffer.from("pre-existing-backup-bytes-v1"));
    const seededLen = fs.statSync(seededBackup).size;
    const seededHash = hashFile(seededBackup);
    const filesBefore = new Set(fs.readdirSync(backupDir));

    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDir,
      }),
    );

    const first = await setupManagerHousehold(
      harness,
      `r1.${Date.now().toString(36)}`,
      "Reset One",
    );
    const reset1 = await reauthAndReset(harness, first, 1);
    expect(reset1.statusCode).toBe(200);
    expect((reset1.json() as { resultEpoch: number }).resultEpoch).toBe(2);

    const second = await setupManagerHousehold(
      harness,
      `r2.${Date.now().toString(36)}`,
      "Reset Two",
    );
    const reset2 = await reauthAndReset(harness, second, 2);
    expect(reset2.statusCode).toBe(200);
    expect((reset2.json() as { resultEpoch: number }).resultEpoch).toBe(3);

    const meta = await harness.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect((meta.json() as { installationEpoch: number }).installationEpoch).toBe(3);
    expect((meta.json() as { setupRequired: boolean }).setupRequired).toBe(true);

    const filesAfter = fs.readdirSync(backupDir);
    expect(new Set(filesAfter)).toEqual(filesBefore);
    expect(fs.statSync(seededBackup).size).toBe(seededLen);
    expect(hashFile(seededBackup)).toBe(seededHash);
  });
});

describe("P0-008A AT8 continuation recovery", () => {
  it("AT8 continuation-only recovery, wrong id denial, replay cannot wipe newer data", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const first = await setupManagerHousehold(
      harness,
      `cont.${Date.now().toString(36)}`,
      "Continuation HH",
    );
    const mutationId = randomUUID();
    const reset = await reauthAndReset(harness, first, 1, mutationId);
    expect(reset.statusCode).toBe(200);
    const resetBody = reset.json() as { operationId: string; resultEpoch: number };
    const contCookie = reset.cookies.find(
      (c) => c.name === harness.config.recoveryContinuationCookieName,
    );
    expect(contCookie?.value).toBeTruthy();
    const continuation = `${contCookie!.name}=${contCookie!.value}`;

    // Member session was revoked; continuation alone recovers status.
    const byId = await harness.app.inject({
      method: "GET",
      url: `/api/v1/lifecycle/operations/${resetBody.operationId}`,
      headers: { cookie: continuation },
    });
    expect(byId.statusCode).toBe(200);
    expect((byId.json() as { status: string }).status).toBe("completed");

    const recovery = await harness.app.inject({
      method: "GET",
      url: "/api/v1/lifecycle/recovery",
      headers: { cookie: continuation },
    });
    expect(recovery.statusCode).toBe(200);
    expect((recovery.json() as { status: string }).status).toBe("completed");

    const wrongId = await harness.app.inject({
      method: "GET",
      url: `/api/v1/lifecycle/operations/${randomUUID()}`,
      headers: { cookie: continuation },
    });
    expect(wrongId.statusCode).toBe(403);

    const owner = await ownerSession(harness);
    const ownerStatus = await harness.app.inject({
      method: "GET",
      url: `/api/v1/lifecycle/operations/${resetBody.operationId}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownerStatus.statusCode).toBe(200);
    expect((ownerStatus.json() as { status: string }).status).toBe("completed");

    const second = await setupManagerHousehold(
      harness,
      `newer.${Date.now().toString(36)}`,
      "Post Reset HH",
    );
    expect(
      (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number })
        .c,
    ).toBe(1);

    const staleReplay = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        cookie: first.cookie,
        "x-csrf-token": first.csrf,
        "content-type": "application/json",
      },
      payload: {
        mutationId,
        confirmationText: "RESET",
        expectedEpoch: 1,
      },
    });
    expect(staleReplay.statusCode).toBe(401);
    expect(
      (harness.runtime.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number })
        .c,
    ).toBe(1);
    expect(harness.runtime.epoch).toBe(2);

    // Expired/revoked continuation fails.
    harness.runtime.control.revokeRecoveryContinuationsForOperation(resetBody.operationId);
    const revoked = await harness.app.inject({
      method: "GET",
      url: "/api/v1/lifecycle/recovery",
      headers: { cookie: continuation },
    });
    expect(revoked.statusCode).toBe(401);
    void second;
  });
});

describe("P0-008A AT9 atomic replacement faults", () => {
  async function seedHouseholdForFault(harness: HttpHarness): Promise<string> {
    const hh = randomUUID();
    harness.runtime.db
      .prepare(`INSERT INTO households (id, name, timezone) VALUES (?, 'Fault Keep', 'UTC')`)
      .run(hh);
    return hh;
  }

  async function assertCoherentAfterReopen(
    previous: HttpHarness,
    expected: "old" | "new",
    oldHouseholdId: string,
    operationId: string,
  ): Promise<HttpHarness> {
    const reopened = await reopenHarness(previous);
    if (expected === "old") {
      expect(
        (
          reopened.db
            .prepare("SELECT name FROM households WHERE id = ?")
            .get(oldHouseholdId) as { name: string } | undefined
        )?.name,
      ).toBe("Fault Keep");
      expect(reopened.runtime.epoch).toBe(1);
    } else {
      expect(
        (reopened.db.prepare("SELECT COUNT(*) AS c FROM households").get() as { c: number }).c,
      ).toBe(0);
      expect(reopened.runtime.epoch).toBe(2);
    }
    const op = reopened.runtime.control.getLifecycleOperation(operationId);
    expect(op).toBeTruthy();
    expect(["completed", "failed"]).toContain(op!.status);
    expect(op!.status).not.toBe("pending");
    return reopened;
  }

  it("AT9 fault beforePrepare leaves original database intact after reopen", async () => {
    const harness = trackHarness(
      await createHttpHarness(
        {
          AUTO_SEED: "0",
          INSTALLATION_OWNER_SECRET: OWNER_SECRET,
          INSTALLATION_CONTROL_PATH: controlPathForTest(),
          BACKUP_DIR: backupDirForTest(),
        },
        {
          faultHooks: {
            beforePrepare: () => {
              throw new Error("fault:beforePrepare");
            },
          },
        },
      ),
    );
    const hh = await seedHouseholdForFault(harness);
    const operationId = randomUUID();
    harness.runtime.control.beginLifecycleOperation({
      id: operationId,
      kind: "household_reset",
      sourceEpoch: harness.runtime.epoch,
      initiatorKind: "test",
      initiatorRef: "fault",
      payloadDigest: createHash("sha256").update(operationId).digest("hex"),
    });
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId,
        sourceEpoch: harness.runtime.epoch,
      }),
    ).rejects.toThrow(/fault:beforePrepare/);
    await assertCoherentAfterReopen(harness, "old", hh, operationId);
  });

  it("AT9 fault beforeActivate leaves original database intact after reopen", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const hh = await seedHouseholdForFault(harness);
    harness.runtime.faultHooks.beforeActivate = () => {
      throw new Error("fault:beforeActivate");
    };
    const operationId = randomUUID();
    harness.runtime.control.beginLifecycleOperation({
      id: operationId,
      kind: "household_reset",
      sourceEpoch: harness.runtime.epoch,
      initiatorKind: "test",
      initiatorRef: "fault",
      payloadDigest: createHash("sha256").update(operationId).digest("hex"),
    });
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId,
        sourceEpoch: harness.runtime.epoch,
      }),
    ).rejects.toThrow(/fault:beforeActivate/);
    await assertCoherentAfterReopen(harness, "old", hh, operationId);
  });

  it("AT9 fault afterActivate (after reopen) completes replacement and reconciles", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const hh = await seedHouseholdForFault(harness);
    harness.runtime.faultHooks.afterActivate = () => {
      throw new Error("fault:afterActivate");
    };
    const operationId = randomUUID();
    harness.runtime.control.beginLifecycleOperation({
      id: operationId,
      kind: "household_reset",
      sourceEpoch: 1,
      initiatorKind: "test",
      initiatorRef: "fault",
      payloadDigest: createHash("sha256").update(operationId).digest("hex"),
    });
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId,
        sourceEpoch: 1,
      }),
    ).rejects.toThrow(/fault:afterActivate/);
    // Activation already committed; runtime should serve the new empty image.
    expect(harness.runtime.epoch).toBe(2);
    await assertCoherentAfterReopen(harness, "new", hh, operationId);
  });

  it("AT9 fault afterReopen completes replacement and reconciles", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const hh = await seedHouseholdForFault(harness);
    harness.runtime.faultHooks.afterReopen = () => {
      throw new Error("fault:afterReopen");
    };
    const operationId = randomUUID();
    harness.runtime.control.beginLifecycleOperation({
      id: operationId,
      kind: "household_reset",
      sourceEpoch: 1,
      initiatorKind: "test",
      initiatorRef: "fault",
      payloadDigest: createHash("sha256").update(operationId).digest("hex"),
    });
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId,
        sourceEpoch: 1,
      }),
    ).rejects.toThrow(/fault:afterReopen/);
    await assertCoherentAfterReopen(harness, "new", hh, operationId);
  });

  it("AT9 fault beforeCleanup completes replacement; reopen reports completed/failed accurately", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    const hh = await seedHouseholdForFault(harness);
    harness.runtime.faultHooks.beforeCleanup = () => {
      throw new Error("fault:beforeCleanup");
    };
    const operationId = randomUUID();
    harness.runtime.control.beginLifecycleOperation({
      id: operationId,
      kind: "household_reset",
      sourceEpoch: 1,
      initiatorKind: "test",
      initiatorRef: "fault",
      payloadDigest: createHash("sha256").update(operationId).digest("hex"),
    });
    await expect(
      harness.runtime.replaceWithEmptyDatabase({
        operationId,
        sourceEpoch: 1,
      }),
    ).rejects.toThrow(/fault:beforeCleanup/);
    await assertCoherentAfterReopen(harness, "new", hh, operationId);
  });

  it("AT9 concurrent ordinary request waits behind exclusive reset barrier", async () => {
    const harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPathForTest(),
        BACKUP_DIR: backupDirForTest(),
      }),
    );
    await seedHouseholdForFault(harness);
    let releaseHold: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    harness.runtime.faultHooks.beforeActivate = async () => {
      await hold;
    };

    const resetPromise = harness.runtime.replaceWithEmptyDatabase({
      operationId: randomUUID(),
      sourceEpoch: harness.runtime.epoch,
    });

    // Give exclusive barrier time to engage, then issue an ordinary API read.
    await new Promise((r) => setTimeout(r, 50));
    let metaResolved = false;
    const metaPromise = harness.app
      .inject({ method: "GET", url: "/api/v1/meta" })
      .then((res) => {
        metaResolved = true;
        return res;
      });

    await new Promise((r) => setTimeout(r, 80));
    expect(metaResolved).toBe(false);
    releaseHold?.();
    await resetPromise;
    const meta = await metaPromise;
    expect(meta.statusCode).toBe(200);
    expect((meta.json() as { installationEpoch: number }).installationEpoch).toBe(2);
  });
});

describe("P0-008A AT10 old clients", () => {
  it("AT10 old member/display sessions and stale-epoch mutations are rejected after reset", async () => {
    const controlPath = controlPathForTest();
    const backupDir = backupDirForTest();
    let harness = trackHarness(
      await createHttpHarness({
        AUTO_SEED: "0",
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPath,
        BACKUP_DIR: backupDir,
      }),
    );
    const manager = await setupManagerHousehold(
      harness,
      `oldcli.${Date.now().toString(36)}`,
      "Old Clients HH",
    );
    const display = await enrollDisplay(harness, manager);

    const memberSessionBefore = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: manager.cookie },
    });
    expect(memberSessionBefore.statusCode).toBe(200);
    const displaySessionBefore = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: { cookie: display.displayCookie },
    });
    expect(displaySessionBefore.statusCode).toBe(200);

    const reset = await reauthAndReset(harness, manager, 1);
    expect(reset.statusCode).toBe(200);

    harness = await reopenHarness(harness, {
      INSTALLATION_CONTROL_PATH: controlPath,
      BACKUP_DIR: backupDir,
    });

    await setupManagerHousehold(harness, `newcli.${Date.now().toString(36)}`, "New Epoch HH");

    const oldMember = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: manager.cookie },
    });
    expect(oldMember.statusCode).toBe(401);

    const oldDisplay = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/session",
      headers: { cookie: display.displayCookie },
    });
    expect(oldDisplay.statusCode).toBe(401);

    const staleMutation = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        cookie: manager.cookie,
        "x-csrf-token": manager.csrf,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: 1,
      },
    });
    expect(staleMutation.statusCode).toBe(401);

    // Ordinary authenticated household reads also reject the retired session.
    const people = await harness.app.inject({
      method: "GET",
      url: "/api/v1/people",
      headers: { cookie: manager.cookie },
    });
    expect(people.statusCode).toBe(401);
  });
});
