import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { buildApp } from "../../src/server/app.js";
import { loadConfig, type AppConfig } from "../../src/server/config.js";
import {
  InstallationControl,
  assertInstallationControlReady,
  inspectInstallationControl,
  listInstallationEvidence,
  relativeDbPathFromConfig,
  resolveInstallationControlPath,
} from "../../src/server/installation-control.js";
import {
  createLifecycleRuntime,
  installationStartupDiagnostic,
  resolveActiveHouseholdDbPath,
} from "../../src/server/lifecycle-runtime.js";
import { relocateInstallationControl } from "../../src/server/relocate-control.js";
import {
  PASSPHRASE,
  createHttpHarness,
  httpClaimManager,
  type HttpHarness,
} from "../helpers/auth-fixture.js";

const OWNER_SECRET = "test-owner-secret-with-enough-entropy-0123456789abcdef";
const harnesses: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    await harnesses.pop()?.close();
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function makeVolume(): {
  root: string;
  dbPath: string;
  controlPath: string;
  backupDir: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hd-008f-"));
  tempDirs.push(root);
  return {
    root,
    dbPath: path.join(root, "household.sqlite"),
    controlPath: path.join(root, "installation-control.sqlite"),
    backupDir: path.join(root, "backups"),
  };
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function snapshotVolume(root: string): Map<string, { size: number; hash: string }> {
  const out = new Map<string, { size: number; hash: string }>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        out.set(path.relative(root, abs).split(path.sep).join("/"), {
          size: fs.statSync(abs).size,
          hash: hashFile(abs),
        });
      }
    }
  };
  walk(root);
  return out;
}

function volumeEnv(
  volume: ReturnType<typeof makeVolume>,
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const port = String(8900 + Math.floor(Math.random() * 1000));
  return {
    APP_PROFILE: "test",
    AUTO_SEED: "0",
    DB_PATH: volume.dbPath,
    BACKUP_DIR: volume.backupDir,
    INSTALLATION_CONTROL_PATH: volume.controlPath,
    HOUSEHOLD_TIMEZONE: "America/New_York",
    HOST: "127.0.0.1",
    PORT: port,
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    NODE_ENV: "test",
    ...extra,
  };
}

function expectPreservedCandidates(
  root: string,
  before: Map<string, { size: number; hash: string }>,
): void {
  const after = snapshotVolume(root);
  const ignore = (rel: string) =>
    rel === "installation-control.sqlite-wal" || rel === "installation-control.sqlite-shm";
  for (const [rel, meta] of before) {
    if (ignore(rel)) continue;
    expect(after.get(rel), rel).toEqual(meta);
  }
  for (const rel of after.keys()) {
    if (ignore(rel)) continue;
    expect(before.has(rel), `unexpected new file ${rel}`).toBe(true);
  }
}

function writeActivePointer(controlPath: string, activeAbs: string, epoch: number): void {
  const control = InstallationControl.open(controlPath);
  try {
    control.ensureAdopt(relativeDbPathFromConfig(activeAbs));
    control.activateCandidate(epoch, relativeDbPathFromConfig(activeAbs));
  } finally {
    control.close();
  }
}

async function startVolumeApp(
  volume: ReturnType<typeof makeVolume>,
  extra: Record<string, string | undefined> = {},
) {
  const config = loadConfig(volumeEnv(volume, extra));
  const built = await buildApp(config);
  const handle = {
    ...built,
    origin: config.publicOrigin!,
    close: async () => {
      await built.app.close();
    },
  };
  harnesses.push(handle);
  return handle;
}

describe("P0-008F hosted installation continuity", () => {
  it("AT1 hosted config requires an explicit absolute control path; local default remains", () => {
    expect(() =>
      loadConfig({
        APP_PROFILE: "hosted",
        PUBLIC_ORIGIN: "https://family.example.invalid",
        DB_PATH: path.join(os.tmpdir(), "hosted.sqlite"),
        BACKUP_DIR: path.join(os.tmpdir(), "hosted-backups"),
      }),
    ).toThrow(/INSTALLATION_CONTROL_PATH/);
    expect(() =>
      loadConfig({
        APP_PROFILE: "hosted",
        PUBLIC_ORIGIN: "https://family.example.invalid",
        DB_PATH: path.join(os.tmpdir(), "hosted.sqlite"),
        BACKUP_DIR: path.join(os.tmpdir(), "hosted-backups"),
        INSTALLATION_CONTROL_PATH: "runtime/installation-control.sqlite",
      }),
    ).toThrow(/absolute path/i);
    const development = loadConfig({ APP_PROFILE: "development" });
    expect(development.installationControlPath).toBe("runtime/installation-control.sqlite");
    const testProfile = loadConfig({ APP_PROFILE: "test" });
    expect(testProfile.installationControlPath).toBe("runtime/installation-control.sqlite");
  });

  it("AT2 volume-mount paths inside the mount pass; a path outside fails without writes", () => {
    const volume = makeVolume();
    const before = snapshotVolume(volume.root);
    const inside = loadConfig({
      APP_PROFILE: "hosted",
      PUBLIC_ORIGIN: "https://family.example.invalid",
      RAILWAY_VOLUME_MOUNT_PATH: volume.root,
      DB_PATH: volume.dbPath,
      BACKUP_DIR: volume.backupDir,
      INSTALLATION_CONTROL_PATH: volume.controlPath,
    });
    expect(inside.installationControlPath).toBe(volume.controlPath);
    expect(() =>
      loadConfig({
        APP_PROFILE: "hosted",
        PUBLIC_ORIGIN: "https://family.example.invalid",
        RAILWAY_VOLUME_MOUNT_PATH: volume.root,
        DB_PATH: path.join(os.tmpdir(), "outside-household.sqlite"),
        BACKUP_DIR: volume.backupDir,
        INSTALLATION_CONTROL_PATH: volume.controlPath,
      }),
    ).toThrow(/RAILWAY_VOLUME_MOUNT_PATH/);
    expect(snapshotVolume(volume.root)).toEqual(before);
    expect(fs.existsSync(volume.dbPath)).toBe(false);
    expect(fs.existsSync(volume.controlPath)).toBe(false);
  });

  it("AT3 empty volume initializes control first, epoch 1, and leaves setup available", async () => {
    const volume = makeVolume();
    const app = await startVolumeApp(volume, { INSTALLATION_OWNER_SECRET: OWNER_SECRET });
    expect(fs.existsSync(volume.controlPath)).toBe(true);
    expect(app.runtime.epoch).toBe(1);
    expect(path.resolve(app.runtime.activeDbPath)).toBe(path.resolve(volume.dbPath));
    const inspection = inspectInstallationControl(volume.controlPath);
    expect(inspection.status).toBe("valid");
    if (inspection.status === "valid") {
      expect(inspection.state.datasetEpoch).toBe(1);
    }
    const meta = await app.app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(meta.statusCode).toBe(200);
    const body = meta.json() as { setupRequired: boolean; ownerConfigured: boolean; installationEpoch: number };
    expect(body.setupRequired).toBe(true);
    expect(body.ownerConfigured).toBe(true);
    expect(body.installationEpoch).toBe(1);
    expect(installationStartupDiagnostic(app.runtime)).toEqual({
      installationControlPath: path.resolve(volume.controlPath),
      activeDatabasePath: path.resolve(volume.dbPath),
      installationEpoch: 1,
    });
  });

  it("AT4/AT6/AT10 process B on a fresh app runtime keeps household, auth, catalog; missing control fails closed", async () => {
    const volume = makeVolume();
    const first = await startVolumeApp(volume, { AUTO_SEED: "1" });
    const session = await httpClaimManager(
      {
        app: first.app,
        store: first.store,
        db: first.db,
        config: first.config,
        dbPath: volume.dbPath,
        origin: first.origin,
        runtime: first.runtime,
        close: first.close,
      } as HttpHarness,
      "morgan.008f",
    );
    const householdId = (
      first.db.prepare(`SELECT id FROM households LIMIT 1`).get() as { id: string }
    ).id;
    const installationId = first.runtime.installationId;
    const epoch = first.runtime.epoch;
    const activePath = first.runtime.activeDbPath;
    const backup = await first.runtime.createBackup({ label: "pre-redeploy" });
    expect(backup.id).toBeTruthy();

    const createDisplay = await first.app.inject({
      method: "POST",
      url: "/api/v1/displays",
      headers: {
        origin: first.origin,
        cookie: session.cookieHeader,
        "x-csrf-token": session.csrfToken,
        "content-type": "application/json",
      },
      payload: { mutationId: randomUUID(), label: "Kitchen wall" },
    });
    expect(createDisplay.statusCode).toBe(200);
    const code = (createDisplay.json() as { enrollment: { code: string } }).enrollment.code;
    const claimDisplay = await first.app.inject({
      method: "POST",
      url: "/api/v1/display/claim",
      headers: { origin: first.origin, "content-type": "application/json" },
      payload: { code },
    });
    expect(claimDisplay.statusCode).toBe(200);
    const displayCookie = claimDisplay.cookies.find(
      (cookie) => cookie.name === first.config.displayCookieName,
    );
    expect(displayCookie?.value).toBeTruthy();
    const displayHeader = `${displayCookie!.name}=${displayCookie!.value}`;

    await first.app.close();
    const idx = harnesses.indexOf(first);
    if (idx >= 0) harnesses.splice(idx, 1);

    const fakeAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hd-008f-app-"));
    tempDirs.push(fakeAppRoot);
    fs.writeFileSync(path.join(fakeAppRoot, "stale-runtime.sqlite"), "not-used");

    const second = await startVolumeApp(volume, { AUTO_SEED: "0" });
    expect(second.runtime.installationId).toBe(installationId);
    expect(second.runtime.epoch).toBe(epoch);
    expect(path.resolve(second.runtime.activeDbPath)).toBe(path.resolve(activePath));
    expect(
      (second.db.prepare(`SELECT id FROM households LIMIT 1`).get() as { id: string }).id,
    ).toBe(householdId);
    const catalogRows = second.runtime.control.listBackups();
    expect(catalogRows.map((row) => row.id)).toEqual([backup.id]);
    expect(
      fs.existsSync(path.join(volume.backupDir, path.basename(catalogRows[0]!.relativePath))),
    ).toBe(true);

    const reusedSession = await second.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: session.cookieHeader, origin: second.origin },
    });
    expect(reusedSession.statusCode, reusedSession.body).toBe(200);
    const reusedBody = reusedSession.json() as { member: { id: string } };
    expect(reusedBody.member.id).toBe(session.membershipId);

    const reusedPeople = await second.app.inject({
      method: "GET",
      url: "/api/v1/people",
      headers: { cookie: session.cookieHeader, origin: second.origin },
    });
    expect(reusedPeople.statusCode, reusedPeople.body).toBe(200);
    const peopleBody = reusedPeople.json() as { people: Array<{ id: string }> };
    expect(peopleBody.people.some((person) => person.id === session.membershipId)).toBe(true);
    const membershipHousehold = second.db
      .prepare(`SELECT household_id AS householdId FROM household_memberships WHERE id = ?`)
      .get(session.membershipId) as { householdId: string };
    expect(membershipHousehold.householdId).toBe(householdId);

    const login = await second.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: second.origin, "content-type": "application/json" },
      payload: { loginName: "morgan.008f", passphrase: PASSPHRASE },
    });
    expect(login.statusCode, login.body).toBe(200);

    const dashboard = await second.app.inject({
      method: "GET",
      url: "/api/v1/display/dashboard",
      headers: { cookie: displayHeader, origin: second.origin },
    });
    expect(dashboard.statusCode).toBe(200);

    const catalogAfter = second.runtime.control.listBackups();
    expect(catalogAfter.map((row) => row.id)).toEqual([backup.id]);
    expect(catalogAfter[0]?.label).toBe("pre-redeploy");

    await second.app.close();
    const idx2 = harnesses.indexOf(second);
    if (idx2 >= 0) harnesses.splice(idx2, 1);

    const beforeMissing = snapshotVolume(volume.root);
    fs.rmSync(volume.controlPath, { force: true });
    fs.rmSync(`${volume.controlPath}-wal`, { force: true });
    fs.rmSync(`${volume.controlPath}-shm`, { force: true });
    const missingConfig = loadConfig(volumeEnv(volume, { AUTO_SEED: "0" }));
    expect(() => createLifecycleRuntime(missingConfig)).toThrow(/missing/i);
    expect(() => resolveActiveHouseholdDbPath(missingConfig)).toThrow(/missing/i);
    const afterMissing = snapshotVolume(volume.root);
    for (const [rel, meta] of beforeMissing) {
      if (rel.startsWith("installation-control")) continue;
      expect(afterMissing.get(rel), rel).toEqual(meta);
    }
    expect(fs.existsSync(volume.controlPath)).toBe(false);
  });

  it("AT5/AT6/AT8/AT9 epoch-selected active path survives process replacement; unproven files remain", async () => {
    const volume = makeVolume();
    const first = await startVolumeApp(volume, { AUTO_SEED: "1" });
    const session = await httpClaimManager(
      {
        app: first.app,
        store: first.store,
        db: first.db,
        config: first.config,
        dbPath: volume.dbPath,
        origin: first.origin,
        runtime: first.runtime,
        close: first.close,
      } as HttpHarness,
      "morgan.008f.reset",
    );
    const reauth = await first.app.inject({
      method: "POST",
      url: "/api/v1/auth/reauthenticate",
      headers: {
        origin: first.origin,
        cookie: session.cookieHeader,
        "x-csrf-token": session.csrfToken,
        "content-type": "application/json",
      },
      payload: { passphrase: PASSPHRASE },
    });
    expect(reauth.statusCode).toBe(200);
    const reset = await first.app.inject({
      method: "POST",
      url: "/api/v1/household/reset",
      headers: {
        origin: first.origin,
        cookie: session.cookieHeader,
        "x-csrf-token": session.csrfToken,
        "content-type": "application/json",
      },
      payload: {
        mutationId: randomUUID(),
        confirmationText: "RESET",
        expectedEpoch: first.runtime.epoch,
      },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    const resetBody = reset.json() as {
      kind: string;
      resultEpoch: number;
      supersededDbPath: string;
    };
    expect(resetBody.kind).toBe("household_reset");
    expect(resetBody.resultEpoch).toBe(2);
    const epochPath = first.runtime.activeDbPath;
    expect(epochPath).toMatch(/\.epoch-2\.sqlite$/i);
    expect(path.resolve(epochPath)).not.toBe(path.resolve(volume.dbPath));
    expect(fs.existsSync(volume.dbPath)).toBe(false);

    const decoy = path.join(volume.root, "household.epoch-9.sqlite");
    fs.writeFileSync(decoy, "unproven-epoch-candidate");
    const decoyHash = hashFile(decoy);

    await first.app.close();
    const idx = harnesses.indexOf(first);
    if (idx >= 0) harnesses.splice(idx, 1);

    const second = await startVolumeApp(volume, { AUTO_SEED: "0" });
    expect(second.runtime.epoch).toBe(2);
    expect(path.resolve(second.runtime.activeDbPath)).toBe(path.resolve(epochPath));
    expect(path.resolve(second.runtime.activeDbPath)).not.toBe(path.resolve(volume.dbPath));
    expect(fs.existsSync(volume.dbPath)).toBe(false);
    expect(hashFile(decoy)).toBe(decoyHash);
    const completed = second.runtime.control.listCompletedReplacementOperations();
    expect(completed.some((op) => op.kind === "household_reset" && op.status === "completed")).toBe(
      true,
    );
  });

  it("AT9 completed restore names the superseded image and process B keeps that epoch path", async () => {
    const volume = makeVolume();
    const first = await startVolumeApp(volume, { AUTO_SEED: "1" });
    const backup = await first.runtime.createBackup({ label: "restore-source" });
    const restored = await first.runtime.replaceWithRestoredDatabase({
      operationId: randomUUID(),
      sourceEpoch: first.runtime.epoch,
      backupId: backup.id,
      expectedDigest: backup.contentDigest,
    });
    expect(restored.resultEpoch).toBe(2);
    expect(restored.supersededDbPath).toBe(volume.dbPath);
    const epochPath = first.runtime.activeDbPath;
    expect(epochPath).toMatch(/\.epoch-2\.sqlite$/i);
    await first.app.close();
    const idx = harnesses.indexOf(first);
    if (idx >= 0) harnesses.splice(idx, 1);

    const second = await startVolumeApp(volume, { AUTO_SEED: "0" });
    expect(second.runtime.epoch).toBe(2);
    expect(path.resolve(second.runtime.activeDbPath)).toBe(path.resolve(epochPath));
    expect(path.resolve(second.runtime.activeDbPath)).not.toBe(path.resolve(volume.dbPath));
  });

  it("AT7 malformed or inconsistent control fails closed and preserves candidates", async () => {
    const volume = makeVolume();
    const first = await startVolumeApp(volume, { AUTO_SEED: "1" });
    await first.app.close();
    const idx = harnesses.indexOf(first);
    if (idx >= 0) harnesses.splice(idx, 1);

    const decoy = path.join(volume.root, "household.epoch-4.sqlite");
    fs.writeFileSync(decoy, "keep-me");
    fs.writeFileSync(volume.controlPath, "this is not a sqlite database");
    const before = snapshotVolume(volume.root);
    const config = loadConfig(volumeEnv(volume));
    expect(() => createLifecycleRuntime(config)).toThrow(/unreadable|malformed|inconsistent/i);
    expect(snapshotVolume(volume.root)).toEqual(before);

    fs.writeFileSync(volume.controlPath, "");
    const emptyBefore = snapshotVolume(volume.root);
    expect(() => createLifecycleRuntime(loadConfig(volumeEnv(volume)))).toThrow(
      /unreadable|malformed|inconsistent/i,
    );
    expect(snapshotVolume(volume.root)).toEqual(emptyBefore);
    expect(fs.readFileSync(decoy, "utf8")).toBe("keep-me");
  });

  it("AT8 unproven epoch candidates are retained when no completed replacement names them", async () => {
    const volume = makeVolume();
    const app = await startVolumeApp(volume, { AUTO_SEED: "1" });
    const decoy = path.join(volume.root, "household.epoch-8.sqlite");
    fs.writeFileSync(decoy, "still-here");
    app.runtime.reconcilePendingOperations();
    expect(fs.readFileSync(decoy, "utf8")).toBe("still-here");
  });

  it("AT11 relocates a verified control snapshot and aborts when the active database is missing", async () => {
    const volume = makeVolume();
    const app = await startVolumeApp(volume, { AUTO_SEED: "1" });
    const sourceState = app.runtime.control.getState();
    const catalog = app.runtime.control.listBackups();
    await app.app.close();
    const idx = harnesses.indexOf(app);
    if (idx >= 0) harnesses.splice(idx, 1);

    const dest = path.join(volume.root, "control-on-volume.sqlite");
    const sourceHash = hashFile(volume.controlPath);
    const result = await relocateInstallationControl({
      sourcePath: volume.controlPath,
      destPath: dest,
      backupDir: volume.backupDir,
    });
    expect(result.datasetEpoch).toBe(sourceState.datasetEpoch);
    expect(result.installationId).toBe(sourceState.installationId);
    expect(hashFile(volume.controlPath)).toBe(sourceHash);
    expect(inspectInstallationControl(dest).status).toBe("valid");
    const destControl = InstallationControl.open(dest);
    try {
      expect(destControl.getState()).toEqual(sourceState);
      expect(destControl.listBackups().map((row) => row.id)).toEqual(catalog.map((row) => row.id));
    } finally {
      destControl.close();
    }

    const missingActiveVolume = makeVolume();
    const missingControl = InstallationControl.open(missingActiveVolume.controlPath);
    missingControl.ensureAdopt(relativeDbPathFromConfig(missingActiveVolume.dbPath));
    missingControl.close();
    const missingDest = path.join(missingActiveVolume.root, "dest.sqlite");
    await expect(
      relocateInstallationControl({
        sourcePath: missingActiveVolume.controlPath,
        destPath: missingDest,
        backupDir: missingActiveVolume.backupDir,
      }),
    ).rejects.toThrow(/active database is missing/i);
    expect(fs.existsSync(missingDest)).toBe(false);
    expect(fs.existsSync(missingActiveVolume.controlPath)).toBe(true);
  });

  it("AT-target-a valid control with a missing active target fails closed and does not create or select another candidate", () => {
    const volume = makeVolume();
    const missingActive = path.join(volume.root, "household.epoch-2.sqlite");
    const leftoverBase = volume.dbPath;
    fs.mkdirSync(volume.backupDir, { recursive: true });
    fs.writeFileSync(leftoverBase, "base-candidate-bytes");
    fs.writeFileSync(path.join(volume.root, "household.epoch-3.sqlite"), "unproven-epoch-candidate");
    fs.writeFileSync(path.join(volume.backupDir, "kept.sqlite"), "backup-candidate");
    writeActivePointer(volume.controlPath, missingActive, 2);

    const before = snapshotVolume(volume.root);
    const config = loadConfig(volumeEnv(volume, { AUTO_SEED: "0" }));
    expect(() => createLifecycleRuntime(config)).toThrow(/missing/i);
    expect(() => resolveActiveHouseholdDbPath(config)).toThrow(/missing/i);
    expectPreservedCandidates(volume.root, before);
    expect(fs.existsSync(missingActive)).toBe(false);
    expect(fs.existsSync(`${missingActive}-wal`)).toBe(false);
    expect(fs.existsSync(`${missingActive}-shm`)).toBe(false);
    expect(fs.readFileSync(leftoverBase, "utf8")).toBe("base-candidate-bytes");
  });

  it("AT-target-b valid control with an unreadable active target fails closed and preserves candidates", () => {
    const volume = makeVolume();
    fs.mkdirSync(volume.backupDir, { recursive: true });
    fs.writeFileSync(volume.dbPath, "this is not a sqlite database");
    fs.writeFileSync(path.join(volume.root, "household.epoch-4.sqlite"), "keep-epoch");
    fs.writeFileSync(path.join(volume.backupDir, "kept.sqlite"), "backup-candidate");
    writeActivePointer(volume.controlPath, volume.dbPath, 1);

    const before = snapshotVolume(volume.root);
    const config = loadConfig(volumeEnv(volume, { AUTO_SEED: "0" }));
    expect(() => createLifecycleRuntime(config)).toThrow(/unreadable|integrity/i);
    expect(() => resolveActiveHouseholdDbPath(config)).toThrow(/unreadable|integrity/i);
    expectPreservedCandidates(volume.root, before);
    expect(fs.existsSync(`${volume.dbPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${volume.dbPath}-shm`)).toBe(false);
  });

  it("AT-target-c valid control pointing outside the volume mount fails closed without writes", () => {
    const volume = makeVolume();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hd-008f-out-"));
    tempDirs.push(outsideRoot);
    const outsideDb = path.join(outsideRoot, "household.sqlite");
    const outside = new DatabaseConstructor(outsideDb);
    outside.exec("CREATE TABLE marker (id INTEGER);");
    outside.close();
    fs.mkdirSync(volume.backupDir, { recursive: true });
    fs.writeFileSync(volume.dbPath, "inside-base-candidate");
    fs.writeFileSync(path.join(volume.backupDir, "kept.sqlite"), "backup-candidate");
    writeActivePointer(volume.controlPath, outsideDb, 1);

    const beforeVolume = snapshotVolume(volume.root);
    const beforeOutside = hashFile(outsideDb);
    const config = loadConfig(
      volumeEnv(volume, {
        AUTO_SEED: "0",
        RAILWAY_VOLUME_MOUNT_PATH: volume.root,
      }),
    );
    expect(() => createLifecycleRuntime(config)).toThrow(/RAILWAY_VOLUME_MOUNT_PATH|outside/i);
    expect(() => resolveActiveHouseholdDbPath(config)).toThrow(/RAILWAY_VOLUME_MOUNT_PATH|outside/i);
    expectPreservedCandidates(volume.root, beforeVolume);
    expect(hashFile(outsideDb)).toBe(beforeOutside);
    expect(fs.existsSync(`${outsideDb}-wal`)).toBe(false);
  });

  it("operator scripts share fail-closed resolution with startup", () => {
    const volume = makeVolume();
    fs.writeFileSync(volume.dbPath, "household-bytes");
    const config = loadConfig(volumeEnv(volume)) as AppConfig;
    expect(listInstallationEvidence(config).length).toBeGreaterThan(0);
    expect(() => assertInstallationControlReady(config)).toThrow(/missing/i);
    expect(() => resolveActiveHouseholdDbPath(config)).toThrow(/missing/i);
    expect(fs.readFileSync(volume.dbPath, "utf8")).toBe("household-bytes");
    expect(inspectInstallationControl(volume.controlPath).status).toBe("missing");
  });
});

describe("P0-008F AT6 harness still supports local HTTP defaults", () => {
  it("createHttpHarness still boots a disposable test installation", async () => {
    const harness = await createHttpHarness({ AUTO_SEED: "1" });
    harnesses.push(harness);
    expect(harness.runtime.epoch).toBe(1);
    expect(resolveInstallationControlPath(harness.config.installationControlPath)).toBe(
      path.resolve(harness.config.installationControlPath),
    );
    expect(relativeDbPathFromConfig(harness.config.dbPath).length).toBeGreaterThan(0);
  });
});
