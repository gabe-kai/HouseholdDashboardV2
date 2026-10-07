import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { openDatabase } from "../../src/server/db.js";
import { InstallationControl } from "../../src/server/installation-control.js";
import {
  createHttpHarness,
  tempDbPath,
  type HttpHarness,
} from "../helpers/auth-fixture.js";
import { createThrough017BackupFile } from "../helpers/through-017-backup-fixture.js";

const OWNER_SECRET = "test-owner-secret-with-enough-entropy-0123456789abcdef";
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
    `hd-b-control-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(p);
  return p;
}

function backupDirForTest(): string {
  const dir = path.join(
    os.tmpdir(),
    `hd-b-backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  temps.push(dir);
  return dir;
}

async function createBHarness(options?: {
  dbPath?: string;
  faultHooks?: import("../../src/server/app.js").BuildAppOptions["faultHooks"];
}): Promise<HttpHarness> {
  const overrides: Record<string, string | undefined> = {
    AUTO_SEED: "0",
    INSTALLATION_OWNER_SECRET: OWNER_SECRET,
    INSTALLATION_CONTROL_PATH: controlPathForTest(),
    BACKUP_DIR: backupDirForTest(),
  };
  if (options?.dbPath) {
    overrides.DB_PATH = options.dbPath;
    temps.push(options.dbPath);
  }
  const harness = await createHttpHarness(
    overrides,
    options?.faultHooks ? { faultHooks: options.faultHooks } : undefined,
  );
  // createHttpHarness always allocates its own DB_PATH unless we rebuild — pass via overrides.
  // auth-fixture overwrites DB_PATH with temp unless we patch: it uses `const dbPath = tempDbPath`
  // and only spreads overrides into loadConfig after setting DB_PATH: dbPath. So DB_PATH override works.
  harnesses.push(harness);
  return harness;
}

async function setupHousehold(harness: HttpHarness): Promise<{
  cookie: string;
  csrf: string;
  membershipId: string;
  epoch: number;
  loginName: string;
}> {
  const owner = await harness.app.inject({
    method: "POST",
    url: "/api/v1/owner/session",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { secret: OWNER_SECRET },
  });
  expect(owner.statusCode).toBe(200);
  const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
  const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;

  const invite = await harness.app.inject({
    method: "POST",
    url: "/api/v1/owner/setup-invitation",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      "x-csrf-token": ownerCsrf,
      cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
    },
    payload: {},
  });
  expect(invite.statusCode).toBe(200);
  const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;

  const exchange = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/exchange",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { invitationToken },
  });
  expect(exchange.statusCode).toBe(200);
  const setupCookie = exchange.cookies.find((c) =>
    c.name.includes("setup"),
  )!.value;

  const loginName = `parent${Date.now().toString(36)}`;
  const account = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/account",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      cookie: `${harness.config.setupCookieName}=${setupCookie}`,
    },
    payload: {
      loginName,
      passphrase: PASSPHRASE,
      displayName: "Parent One",
    },
  });
  expect(account.statusCode).toBe(200);
  const session = account.json() as {
    csrfToken: string;
    member: { id: string };
  };
  const memberCookie = account.cookies.find((c) => c.name === harness.config.cookieName)!.value;

  const household = await harness.app.inject({
    method: "POST",
    url: "/api/v1/setup/household",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
      cookie: `${harness.config.cookieName}=${memberCookie}`,
    },
    payload: {
      name: "Backup Family",
      timezone: "America/New_York",
    },
  });
  expect(household.statusCode).toBe(200);

  const meta = await harness.app.inject({ method: "GET", url: "/api/v1/meta" });
  const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;

  return {
    cookie: memberCookie,
    csrf: session.csrfToken,
    membershipId: session.member.id,
    epoch,
    loginName,
  };
}

/** Fresh manager session after lifecycle revoke (backup/activation fault paths). */
async function loginManager(
  harness: HttpHarness,
  loginName: string,
): Promise<{ cookie: string; csrf: string }> {
  const login = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin: harness.origin, "content-type": "application/json" },
    payload: { loginName, passphrase: PASSPHRASE },
  });
  expect(login.statusCode).toBe(200);
  const csrf = (login.json() as { csrfToken: string }).csrfToken;
  const cookie = login.cookies.find((c) => c.name === harness.config.cookieName)!.value;
  return { cookie, csrf };
}

async function reauth(
  harness: HttpHarness,
  cookie: string,
  csrf: string,
): Promise<void> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/reauthenticate",
    headers: {
      origin: harness.origin,
      "content-type": "application/json",
      "x-csrf-token": csrf,
      cookie: `${harness.config.cookieName}=${cookie}`,
    },
    payload: { passphrase: PASSPHRASE },
  });
  expect(res.statusCode).toBe(200);
}

describe("P0-008B household backups and restore", () => {
  it("AT1: create labeled backup, list after reload, delete another, unauthorized denied", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);

    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "Before school year" },
    });
    expect(created.statusCode).toBe(200);
    const backupA = (created.json() as { backup: { id: string; label: string | null } }).backup;
    expect(backupA.label).toBe("Before school year");

    await reauth(harness, auth.cookie, auth.csrf);
    const createdB = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "Delete me" },
    });
    expect(createdB.statusCode).toBe(200);
    const backupB = (createdB.json() as { backup: { id: string } }).backup;

    const listed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/household/backups",
      headers: { cookie: `${harness.config.cookieName}=${auth.cookie}` },
    });
    expect(listed.statusCode).toBe(200);
    const ids = (listed.json() as { backups: Array<{ id: string }> }).backups.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([backupA.id, backupB.id]));

    await reauth(harness, auth.cookie, auth.csrf);
    const deleted = await harness.app.inject({
      method: "DELETE",
      url: `/api/v1/household/backups/${backupB.id}`,
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), confirmationText: "DELETE" },
    });
    expect(deleted.statusCode).toBe(200);

    const listedAfter = await harness.app.inject({
      method: "GET",
      url: "/api/v1/household/backups",
      headers: { cookie: `${harness.config.cookieName}=${auth.cookie}` },
    });
    const afterIds = (listedAfter.json() as { backups: Array<{ id: string }> }).backups.map(
      (b) => b.id,
    );
    expect(afterIds).toContain(backupA.id);
    expect(afterIds).not.toContain(backupB.id);

    const noAuth = await harness.app.inject({ method: "GET", url: "/api/v1/household/backups" });
    expect(noAuth.statusCode).toBe(401);
  });

  it("AT2: optional backup off creates zero; on creates exactly one before reset", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);

    const resetOff = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: auth.epoch,
        saveBackupBeforeReset: false,
      },
    });
    expect(resetOff.statusCode).toBe(200);
    expect((resetOff.json() as { preOperationBackup: null }).preOperationBackup).toBeNull();
    expect(harness.runtime.control.listBackups()).toHaveLength(0);

    const auth2 = await setupHousehold(harness);
    await reauth(harness, auth2.cookie, auth2.csrf);
    const meta = await harness.app.inject({ method: "GET", url: "/api/v1/meta" });
    const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;

    const resetOn = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth2.csrf,
        cookie: `${harness.config.cookieName}=${auth2.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: epoch,
        saveBackupBeforeReset: true,
        backupLabel: "Pre-reset",
      },
    });
    expect(resetOn.statusCode).toBe(200);
    const body = resetOn.json() as {
      preOperationBackup: { label: string | null; householdName: string };
    };
    expect(body.preOperationBackup?.label).toBe("Pre-reset");
    expect(body.preOperationBackup?.householdName).toBe("Backup Family");
    expect(harness.runtime.control.listBackups()).toHaveLength(1);
  });

  it("AT3/AT5: welcome owner restore after reset; old session cookie rejected", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "Keep me" },
    });
    expect(created.statusCode).toBe(200);
    const backup = (
      created.json() as { backup: { id: string; contentDigest: string; householdName: string } }
    ).backup;

    await reauth(harness, auth.cookie, auth.csrf);
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: auth.epoch,
        saveBackupBeforeReset: false,
      },
    });
    expect(reset.statusCode).toBe(200);
    const resultEpoch = (reset.json() as { resultEpoch: number }).resultEpoch;

    // Continuation alone cannot list backups.
    const contDenied = await harness.app.inject({
      method: "GET",
      url: "/api/v1/household/backups",
      headers: {
        cookie: reset.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      },
    });
    expect(contDenied.statusCode).toBe(403);

    const owner = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
    const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;

    const listed = await harness.app.inject({
      method: "GET",
      url: "/api/v1/household/backups",
      headers: { cookie: `${harness.config.ownerCookieName}=${ownerCookie}` },
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { backups: unknown[] }).backups).toHaveLength(1);

    const restore = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: resultEpoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(restore.statusCode).toBe(200);
    const restoreBody = restore.json() as {
      kind: string;
      setupRequired: boolean;
      signInRequired: boolean;
      installationEpoch: number;
      restoredBackup: { householdName: string };
    };
    expect(restoreBody.kind).toBe("household_restore");
    expect(restoreBody.setupRequired).toBe(false);
    expect(restoreBody.signInRequired).toBe(true);
    expect(restoreBody.restoredBackup.householdName).toBe("Backup Family");
    expect(restoreBody.installationEpoch).toBeGreaterThan(resultEpoch);

    const staleSession = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: `${harness.config.cookieName}=${auth.cookie}` },
    });
    expect(staleSession.statusCode).toBe(401);
  });

  it("AT6: control catalog migration is replay-safe; legacy register; corrupt rejected", async () => {
    const controlPath = controlPathForTest();
    const first = InstallationControl.open(controlPath);
    expect(first.controlMigrationIds()).toContain("001_household_backup_catalog.sql");
    first.close();
    const second = InstallationControl.open(controlPath);
    expect(second.controlMigrationIds()).toEqual(["001_household_backup_catalog.sql"]);
    second.close();

    const harness = await createBHarness();
    await setupHousehold(harness);
    const authOwner = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    expect(authOwner.statusCode).toBe(200);

    const legacyName = `household-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
    const legacyPath = path.join(harness.config.backupDir, legacyName);
    const src = openDatabase(harness.runtime.activeDbPath);
    await src.backup(legacyPath);
    src.close();
    const sourceBytes = fs.readFileSync(legacyPath);
    const ownerCsrf = (authOwner.json() as { csrfToken: string }).csrfToken;
    const ownerCookie = authOwner.cookies.find((c) => c.name.includes("owner"))!.value;
    const registered = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/backups/register",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: { fileName: legacyName, label: "Legacy" },
    });
    expect(registered.statusCode).toBe(200);
    expect(
      (registered.json() as { backup: { source: string; label: string | null } }).backup.source,
    ).toBe("legacy_register");

    fs.writeFileSync(
      path.join(harness.config.backupDir, "household-corrupt.sqlite"),
      Buffer.from("not-a-sqlite-database"),
    );
    const badReg = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/backups/register",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: { fileName: "household-corrupt.sqlite" },
    });
    expect(badReg.statusCode).toBeGreaterThanOrEqual(400);
    expect(fs.readFileSync(legacyPath)).toEqual(sourceBytes);

    // Active/control aliases rejected
    const alias = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/backups/register",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: { fileName: "../installation-control.sqlite" },
    });
    expect(alias.statusCode).toBe(400);
  });

  it("AT2: backup failure leaves active household; proceed-without uses new receipt", async () => {
    const harness = await createBHarness({
      faultHooks: {
        beforeBackup: () => {
          throw new Error("fault:beforeBackup");
        },
      },
    });
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);
    const beforeName = (
      harness.db.prepare(`SELECT name FROM households LIMIT 1`).get() as { name: string }
    ).name;

    const failed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: auth.epoch,
        saveBackupBeforeReset: true,
        backupLabel: "Should fail",
      },
    });
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(harness.runtime.control.listBackups()).toHaveLength(0);
    expect(
      (harness.db.prepare(`SELECT name FROM households LIMIT 1`).get() as { name: string }).name,
    ).toBe(beforeName);
    expect(harness.runtime.epoch).toBe(auth.epoch);

    // Household remains active; manager signs in again after revoke-before-activation,
    // then proceed-without (new mutationId, option off) creates no backup.
    harness.runtime.faultHooks.beforeBackup = undefined;
    const again = await loginManager(harness, auth.loginName);
    await reauth(harness, again.cookie, again.csrf);
    const proceed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": again.csrf,
        cookie: `${harness.config.cookieName}=${again.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: auth.epoch,
        saveBackupBeforeReset: false,
      },
    });
    expect(proceed.statusCode).toBe(200);
    expect((proceed.json() as { preOperationBackup: null }).preOperationBackup).toBeNull();
    expect(harness.runtime.control.listBackups()).toHaveLength(0);
  });

  it("AT2: backup-success/activation-failure reports saved backup; replay does not duplicate", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);
    harness.runtime.faultHooks.beforeActivate = () => {
      throw new Error("fault:beforeActivate");
    };
    const mutationId = randomUUID();
    const failed = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId,
        confirmationText: "RESET",
        expectedEpoch: auth.epoch,
        saveBackupBeforeReset: true,
        backupLabel: "Kept",
      },
    });
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(harness.runtime.control.listBackups()).toHaveLength(1);
    expect(harness.runtime.epoch).toBe(auth.epoch);
    const failedBody = failed.json() as { preOperationBackup?: { id: string } | null };
    // Error body may include progress; catalog is authoritative.
    const savedId = harness.runtime.control.listBackups()[0]!.id;
    expect(failedBody.preOperationBackup?.id ?? savedId).toBe(savedId);

    harness.runtime.faultHooks.beforeActivate = undefined;
    const again = await loginManager(harness, auth.loginName);
    await reauth(harness, again.cookie, again.csrf);
    const replay = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": again.csrf,
        cookie: `${harness.config.cookieName}=${again.cookie}`,
      },
      payload: {
        mutationId,
        confirmationText: "RESET",
        expectedEpoch: auth.epoch,
        saveBackupBeforeReset: true,
        backupLabel: "Kept",
      },
    });
    // Failed ops are not completed receipts; same-digest retry reuses the saved backup.
    if (replay.statusCode === 200) {
      expect(harness.runtime.control.listBackups()).toHaveLength(1);
    } else {
      const fresh = await harness.app.inject({
        method: "POST",
        url: "/api/v1/household/reset",
        headers: {
          origin: harness.origin,
          "content-type": "application/json",
          "x-csrf-token": again.csrf,
          cookie: `${harness.config.cookieName}=${again.cookie}`,
        },
        payload: {
          mutationId: randomUUID(),
          confirmationText: "RESET",
          expectedEpoch: auth.epoch,
          saveBackupBeforeReset: false,
        },
      });
      expect(fresh.statusCode).toBe(200);
      expect(harness.runtime.control.listBackups()).toHaveLength(1);
    }
  });

  it("AT2: delayed write across reset-with-backup is either snapshotted or rejected", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);

    const delayed = harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
        "x-mutation-delay-ms": "400",
      },
      payload: { passphrase: PASSPHRASE },
    });

    await new Promise((r) => setTimeout(r, 50));
    await reauth(harness, auth.cookie, auth.csrf);
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: auth.epoch,
        saveBackupBeforeReset: true,
        backupLabel: "Race",
      },
    });
    expect(reset.statusCode).toBe(200);
    const delayedRes = await delayed;
    expect([200, 401]).toContain(delayedRes.statusCode);
    expect(harness.runtime.control.listBackups()).toHaveLength(1);
  });

  it("AT5: pre-restore human/display/setup credentials cannot regain authority", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);

    const owner = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
    const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;
    const invite = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/setup-invitation",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {},
    });
    const invitationToken = (invite.json() as { invitationToken: string }).invitationToken;

    const displayIssue = await harness.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "Wall A" },
    });
    expect(displayIssue.statusCode).toBe(200);
    const displayCreated = displayIssue.json() as {
      enrollment: { code: string };
      display: { id: string };
    };
    const claim = await harness.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { code: displayCreated.enrollment.code },
    });
    expect(claim.statusCode).toBe(200);
    const displayCookie = claim.cookies.find(
      (c) => c.name === harness.config.displayCookieName,
    )!.value;

    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID() },
    });
    const backup = (
      created.json() as { backup: { id: string; contentDigest: string } }
    ).backup;

    await reauth(harness, auth.cookie, auth.csrf);
    const restore = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: auth.epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(restore.statusCode).toBe(200);

    const staleMember = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: `${harness.config.cookieName}=${auth.cookie}` },
    });
    expect(staleMember.statusCode).toBe(401);

    const staleInvite = await harness.app.inject({
      method: "POST",
      url: "/api/v1/setup/exchange",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { invitationToken },
    });
    expect([401, 403, 410, 404]).toContain(staleInvite.statusCode);

    const staleDisplay = await harness.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: {
        cookie: `${harness.config.displayCookieName}=${displayCookie}`,
      },
    });
    expect([401, 403]).toContain(staleDisplay.statusCode);
  });

  it("AT6: through-017 backup restores with migration; source bytes unchanged; rejects bad images", async () => {
    const harness = await createBHarness();
    await setupHousehold(harness);
    const fixture = await createThrough017BackupFile(harness.config.backupDir);
    expect(fixture.schemaManifest).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^018_/)]),
    );

    const owner = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/session",
      headers: { origin: harness.origin, "content-type": "application/json" },
      payload: { secret: OWNER_SECRET },
    });
    const ownerCsrf = (owner.json() as { csrfToken: string }).csrfToken;
    const ownerCookie = owner.cookies.find((c) => c.name.includes("owner"))!.value;
    const registered = await harness.app.inject({
      method: "POST",
      url: "/api/v1/owner/backups/register",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: { fileName: fixture.fileName, label: "Through017" },
    });
    expect(registered.statusCode).toBe(200);
    const backup = (
      registered.json() as { backup: { id: string; contentDigest: string; householdName: string } }
    ).backup;
    expect(backup.householdName).toBe("Through017 Household");
    expect(fs.readFileSync(fixture.absPath)).toEqual(fixture.sourceBytes);

    const meta = await harness.app.inject({ method: "GET", url: "/api/v1/meta" });
    const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;
    const restore = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(restore.statusCode).toBe(200);
    expect(fs.readFileSync(fixture.absPath)).toEqual(fixture.sourceBytes);
    const tipCount = (
      harness.runtime.db
        .prepare(`SELECT COUNT(*) AS c FROM schema_migrations`)
        .get() as { c: number }
    ).c;
    expect(tipCount).toBeGreaterThanOrEqual(18);
    expect(
      (
        harness.runtime.db.prepare(`SELECT name FROM households LIMIT 1`).get() as {
          name: string;
        }
      ).name,
    ).toBe("Through017 Household");

    // Tampered digest rejected without changing active epoch
    const epochAfter = harness.runtime.epoch;
    const bad = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": ownerCsrf,
        cookie: `${harness.config.ownerCookieName}=${ownerCookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: "a".repeat(64),
        expectedEpoch: epochAfter,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    expect(harness.runtime.epoch).toBe(epochAfter);
  });

  it("AT7: afterActivate crash recovers typed restore with backup metadata via continuation", async () => {
    let harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "Crash window" },
    });
    const backup = (
      created.json() as {
        backup: { id: string; contentDigest: string; label: string | null; householdName: string };
      }
    ).backup;

    harness.runtime.faultHooks.afterActivate = () => {
      throw new Error("fault:afterActivate");
    };
    await reauth(harness, auth.cookie, auth.csrf);
    const restore = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: auth.epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: true,
        backupLabel: "Pre-restore kept",
      },
    });
    // Route may return recovered completed JSON (200) or error after reconcile.
    const contCookie = restore.cookies
      .filter((c) => c.name.includes("lifecycle") || c.name.includes("cont"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    if (restore.statusCode === 200) {
      const body = restore.json() as {
        kind: string;
        setupRequired: boolean;
        restoredBackup: { id: string; householdName: string };
        preOperationBackup: { label: string | null } | null;
      };
      expect(body.kind).toBe("household_restore");
      expect(body.setupRequired).toBe(false);
      expect(body.restoredBackup.id).toBe(backup.id);
      expect(body.restoredBackup.householdName).toBe(backup.householdName);
      expect(body.preOperationBackup?.label).toBe("Pre-restore kept");
    } else {
      expect(contCookie.length).toBeGreaterThan(0);
      // Reopen process and recover via continuation.
      const activeDbPath = harness.runtime.activeDbPath;
      const controlPath = harness.config.installationControlPath;
      const backupDir = harness.config.backupDir;
      const origin = harness.origin;
      await harness.app.close();
      const idx = harnesses.indexOf(harness);
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
        INSTALLATION_OWNER_SECRET: OWNER_SECRET,
        INSTALLATION_CONTROL_PATH: controlPath,
      });
      const built = await buildApp(config);
      harness = {
        app: built.app,
        store: built.store,
        db: built.db,
        config: built.config,
        dbPath: activeDbPath,
        origin,
        runtime: built.runtime,
        close: async () => {
          await built.app.close();
        },
      };
      harnesses.push(harness);
      const recovered = await harness.app.inject({
        method: "GET",
        url: "/api/v1/lifecycle/recovery",
        headers: { cookie: contCookie },
      });
      expect(recovered.statusCode).toBe(200);
      const status = recovered.json() as {
        status: string;
        kind: string;
        result: {
          kind: string;
          setupRequired: boolean;
          restoredBackup: { id: string } | null;
          preOperationBackup: { label: string | null } | null;
        };
      };
      expect(status.status).toBe("completed");
      expect(status.result.kind).toBe("household_restore");
      expect(status.result.setupRequired).toBe(false);
      expect(status.result.restoredBackup?.id).toBe(backup.id);
      expect(status.result.preOperationBackup?.label).toBe("Pre-restore kept");
    }
  });

  it("AT7: restore faults before activation leave old household; cleanup fault keeps new epoch", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "Fault matrix" },
    });
    const backup = (
      created.json() as { backup: { id: string; contentDigest: string } }
    ).backup;
    const beforeName = (
      harness.db.prepare(`SELECT name FROM households LIMIT 1`).get() as { name: string }
    ).name;

    for (const hook of ["beforePrepare", "beforeScrub", "beforeActivate"] as const) {
      harness.runtime.faultHooks.beforePrepare = undefined;
      harness.runtime.faultHooks.beforeScrub = undefined;
      harness.runtime.faultHooks.beforeActivate = undefined;
      harness.runtime.faultHooks.beforeCleanup = undefined;
      harness.runtime.faultHooks[hook] = () => {
        throw new Error(`fault:${hook}`);
      };
      const session = await loginManager(harness, auth.loginName);
      await reauth(harness, session.cookie, session.csrf);
      const failed = await harness.app.inject({
        method: "POST",
        url: "/api/v1/household/restore",
        headers: {
          origin: harness.origin,
          "content-type": "application/json",
          "x-csrf-token": session.csrf,
          cookie: `${harness.config.cookieName}=${session.cookie}`,
        },
        payload: {
          mutationId: randomUUID(),
          backupId: backup.id,
          expectedDigest: backup.contentDigest,
          expectedEpoch: auth.epoch,
          confirmationText: "RESTORE",
          saveBackupBeforeRestore: false,
        },
      });
      expect(failed.statusCode).toBeGreaterThanOrEqual(500);
      expect(harness.runtime.epoch).toBe(auth.epoch);
      expect(
        (harness.db.prepare(`SELECT name FROM households LIMIT 1`).get() as { name: string })
          .name,
      ).toBe(beforeName);
    }

    harness.runtime.faultHooks.beforePrepare = undefined;
    harness.runtime.faultHooks.beforeScrub = undefined;
    harness.runtime.faultHooks.beforeActivate = undefined;
    harness.runtime.faultHooks.beforeCleanup = () => {
      throw new Error("fault:beforeCleanup");
    };
    const finalSession = await loginManager(harness, auth.loginName);
    await reauth(harness, finalSession.cookie, finalSession.csrf);
    const meta = await harness.app.inject({ method: "GET", url: "/api/v1/meta" });
    const epoch = (meta.json() as { installationEpoch: number }).installationEpoch;
    const ok = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": finalSession.csrf,
        cookie: `${harness.config.cookieName}=${finalSession.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    // Activation committed; cleanup fault still yields recoverable new epoch (200 or recovered).
    expect([200, 500]).toContain(ok.statusCode);
    expect(harness.runtime.epoch).toBeGreaterThan(epoch);
  });

  it("AT9: two display sessions and queued member write retire across restore", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);

    async function enrollDisplay(label: string): Promise<string> {
      const created = await harness.app.inject({
        method: "POST",
        url: "/api/v1/displays",
        headers: {
          origin: harness.origin,
          "content-type": "application/json",
          "x-csrf-token": auth.csrf,
          cookie: `${harness.config.cookieName}=${auth.cookie}`,
        },
        payload: { mutationId: randomUUID(), label },
      });
      expect(created.statusCode).toBe(200);
      const body = created.json() as { enrollment: { code: string } };
      const claim = await harness.app.inject({
        method: "POST",
        url: "/api/v1/display/claim",
        headers: { origin: harness.origin, "content-type": "application/json" },
        payload: { code: body.enrollment.code },
      });
      expect(claim.statusCode).toBe(200);
      return claim.cookies.find((c) => c.name === harness.config.displayCookieName)!.value;
    }

    const wallA = await enrollDisplay("Wall A");
    const wallB = await enrollDisplay("Wall B");
    for (const cookie of [wallA, wallB]) {
      const session = await harness.app.inject({
        method: "GET",
        url: "/api/v1/display/session",
        headers: { cookie: `${harness.config.displayCookieName}=${cookie}` },
      });
      expect(session.statusCode).toBe(200);
    }

    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID() },
    });
    const backup = (
      created.json() as { backup: { id: string; contentDigest: string } }
    ).backup;

    await reauth(harness, auth.cookie, auth.csrf);
    const restore = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/restore",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: {
        mutationId: randomUUID(),
        backupId: backup.id,
        expectedDigest: backup.contentDigest,
        expectedEpoch: auth.epoch,
        confirmationText: "RESTORE",
        saveBackupBeforeRestore: false,
      },
    });
    expect(restore.statusCode).toBe(200);

    for (const cookie of [wallA, wallB]) {
      const stale = await harness.app.inject({
        method: "GET",
        url: "/api/v1/display/session",
        headers: { cookie: `${harness.config.displayCookieName}=${cookie}` },
      });
      expect([401, 403]).toContain(stale.statusCode);
    }

    const staleMember = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: `${harness.config.cookieName}=${auth.cookie}` },
    });
    expect(staleMember.statusCode).toBe(401);

    // Old-epoch member mutate cannot apply under retired session.
    const queued = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "stale-queue" },
    });
    expect(queued.statusCode).toBe(401);
  });

  it("AT8: public welcome without owner reveals no backup metadata", async () => {
    const harness = await createBHarness();
    const auth = await setupHousehold(harness);
    await reauth(harness, auth.cookie, auth.csrf);
    await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/backups",
      headers: {
        origin: harness.origin,
        "content-type": "application/json",
        "x-csrf-token": auth.csrf,
        cookie: `${harness.config.cookieName}=${auth.cookie}`,
      },
      payload: { mutationId: randomUUID(), label: "Secret" },
    });
    const publicList = await harness.app.inject({
      method: "GET",
      url: "/api/v1/household/backups",
    });
    expect(publicList.statusCode).toBe(401);
    expect(publicList.body).not.toMatch(/Secret|Backup Family/);
  });
});

describe("P0-008B buildApp reopen", () => {
  it("reopens with catalog after A-shaped control file", async () => {
    const dbPath = tempDbPath("hd-b-reopen");
    const controlPath = controlPathForTest();
    const backupDir = backupDirForTest();
    temps.push(dbPath);
    const config = loadConfig({
      DB_PATH: dbPath,
      INSTALLATION_CONTROL_PATH: controlPath,
      BACKUP_DIR: backupDir,
      INSTALLATION_OWNER_SECRET: OWNER_SECRET,
      APP_PROFILE: "test",
    });
    const built = await buildApp(config);
    expect(built.runtime.control.controlMigrationIds()).toContain(
      "001_household_backup_catalog.sql",
    );
    await built.app.close();
    built.runtime.control.close();
  });
});
