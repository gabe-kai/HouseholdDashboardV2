import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import DatabaseConstructor from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./config.js";
import { migrate, openDatabase } from "./db.js";
import type { InstallationControl, HouseholdBackupRow } from "./installation-control.js";
import { resolveActiveDbAbsolutePath } from "./installation-control.js";

export const BACKUP_FORMAT_VERSION = 1;
/** Oldest household schema tip accepted for restore admission. */
export const MIN_SUPPORTED_MIGRATION_ID = "017_personal_task_wall_promotion.sql";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../db/migrations");

export type BackupPublicMeta = {
  id: string;
  householdId: string;
  householdName: string;
  createdAt: string;
  label: string | null;
  schemaManifest: string[];
  formatVersion: number;
  byteSize: number;
  contentDigest: string;
  source: "app" | "legacy_register";
};

export type BackupPreview = BackupPublicMeta & {
  currentHouseholdId: string | null;
  currentHouseholdName: string | null;
  replacesCurrent: boolean;
  notes: string[];
};

export function listAppMigrationIds(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function resolveBackupDir(configured: string): string {
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

export function toPublicMeta(row: HouseholdBackupRow): BackupPublicMeta {
  return {
    id: row.id,
    householdId: row.householdId,
    householdName: row.householdName,
    createdAt: row.createdAt,
    label: row.label,
    schemaManifest: JSON.parse(row.schemaManifest) as string[],
    formatVersion: row.formatVersion,
    byteSize: row.byteSize,
    contentDigest: row.contentDigest,
    source: row.source,
  };
}

export function fileSha256Hex(absPath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(absPath));
  return hash.digest("hex");
}

function openReadonly(absPath: string): Database.Database {
  return new DatabaseConstructor(absPath, { readonly: true, fileMustExist: true });
}

export type BackupAdmissionError = {
  code: "UNSUPPORTED" | "CORRUPT" | "CONFLICT" | "NOT_FOUND";
  message: string;
};

export function inspectHouseholdImage(absPath: string): {
  householdId: string;
  householdName: string;
  schemaManifest: string[];
  ok: true;
} | { ok: false; error: BackupAdmissionError } {
  if (!fs.existsSync(absPath)) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Backup file is missing" } };
  }
  let db: Database.Database | undefined;
  try {
    db = openReadonly(absPath);
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      return {
        ok: false,
        error: { code: "CORRUPT", message: "Backup failed SQLite integrity check" },
      };
    }
    const fk = db.pragma("foreign_key_check") as unknown[];
    if (Array.isArray(fk) && fk.length > 0) {
      return {
        ok: false,
        error: { code: "CORRUPT", message: "Backup failed foreign-key check" },
      };
    }
    const hasMigrations = db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get() as { ok: number } | undefined;
    if (!hasMigrations) {
      return {
        ok: false,
        error: { code: "UNSUPPORTED", message: "Backup has no recognizable schema history" },
      };
    }
    const schemaManifest = (
      db.prepare(`SELECT id FROM schema_migrations ORDER BY id`).all() as Array<{ id: string }>
    ).map((r) => r.id);
    if (schemaManifest.length === 0) {
      return {
        ok: false,
        error: { code: "UNSUPPORTED", message: "Backup schema history is empty" },
      };
    }
    const appMigrations = listAppMigrationIds();
    const appSet = new Set(appMigrations);
    for (const id of schemaManifest) {
      if (!appSet.has(id)) {
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED",
            message: `Backup requires a newer app (unknown migration ${id})`,
          },
        };
      }
    }
    if (!schemaManifest.includes(MIN_SUPPORTED_MIGRATION_ID)) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED",
          message: `Backup is older than supported range (needs ${MIN_SUPPORTED_MIGRATION_ID})`,
        },
      };
    }
    const hasHouseholds = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'households'`)
      .get() as { ok: number } | undefined;
    if (!hasHouseholds) {
      return {
        ok: false,
        error: { code: "UNSUPPORTED", message: "Backup is not a household database" },
      };
    }
    const count = db.prepare(`SELECT COUNT(*) AS c FROM households`).get() as { c: number };
    if (count.c !== 1) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED",
          message:
            count.c === 0
              ? "Backup contains no household"
              : "Multiple households are not supported for restore",
        },
      };
    }
    const household = db
      .prepare(`SELECT id, name FROM households ORDER BY id LIMIT 1`)
      .get() as { id: string; name: string };
    return {
      ok: true,
      householdId: household.id,
      householdName: household.name,
      schemaManifest,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "CORRUPT",
        message: err instanceof Error ? err.message : "Backup could not be opened",
      },
    };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function confinedBackupPath(backupDir: string, relativePath: string): string | null {
  const abs = path.resolve(backupDir, relativePath);
  const root = path.resolve(backupDir) + path.sep;
  if (!abs.startsWith(root) && abs !== path.resolve(backupDir)) return null;
  return abs;
}

export function resolveCatalogFile(
  backupDir: string,
  row: HouseholdBackupRow,
): string | null {
  return confinedBackupPath(backupDir, row.relativePath);
}

/** Create a verified cataloged backup of the active household image. */
export async function createCatalogBackup(input: {
  control: InstallationControl;
  backupDir: string;
  activeDbPath: string;
  /** Prefer the live runtime handle so backup does not open a second writer. */
  liveDb?: Database.Database;
  label?: string | null;
  source?: "app" | "legacy_register";
  /** When registering a legacy file, copy/validate from this absolute path instead of live backup API. */
  legacySourceAbs?: string;
}): Promise<BackupPublicMeta> {
  const backupDir = resolveBackupDir(input.backupDir);
  fs.mkdirSync(backupDir, { recursive: true });

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const fileName = `catalog-${id}.sqlite`;
  const relativePath = fileName;
  const destAbs = path.join(backupDir, fileName);
  const tempAbs = `${destAbs}.partial-${process.pid}`;

  try {
    if (input.legacySourceAbs) {
      const src = path.resolve(input.legacySourceAbs);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
        throw Object.assign(new Error("Legacy backup file not found"), { code: "NOT_FOUND" });
      }
      // Copy via SQLite backup API so WAL siblings are not plain-copied.
      const srcDb = openReadonly(src);
      try {
        await srcDb.backup(tempAbs);
      } finally {
        srcDb.close();
      }
    } else if (input.liveDb) {
      await input.liveDb.backup(tempAbs);
    } else {
      if (!fs.existsSync(input.activeDbPath)) {
        throw Object.assign(new Error("Active household database is missing"), {
          code: "FAILED",
        });
      }
      const live = openDatabase(input.activeDbPath);
      try {
        await live.backup(tempAbs);
      } finally {
        live.close();
      }
    }

    const inspected = inspectHouseholdImage(tempAbs);
    if (!inspected.ok) {
      throw Object.assign(new Error(inspected.error.message), { code: inspected.error.code });
    }
    const digest = fileSha256Hex(tempAbs);
    const byteSize = fs.statSync(tempAbs).size;
    fs.renameSync(tempAbs, destAbs);

    const label =
      input.label == null || input.label.trim() === ""
        ? null
        : input.label.trim().slice(0, 80);

    input.control.insertBackup({
      id,
      householdId: inspected.householdId,
      householdName: inspected.householdName,
      createdAt,
      label,
      schemaManifest: JSON.stringify(inspected.schemaManifest),
      formatVersion: BACKUP_FORMAT_VERSION,
      byteSize,
      contentDigest: digest,
      relativePath,
      source: input.source ?? "app",
    });

    return toPublicMeta(input.control.getBackup(id)!);
  } catch (err) {
    try {
      fs.rmSync(tempAbs, { force: true });
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(destAbs)) fs.rmSync(destAbs, { force: true });
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export function deleteCatalogBackup(input: {
  control: InstallationControl;
  backupDir: string;
  backupId: string;
  /** Refuse if this backup id is pinned by an in-flight restore. */
  pinnedBackupId?: string | null;
}): void {
  if (input.pinnedBackupId && input.pinnedBackupId === input.backupId) {
    throw Object.assign(new Error("Backup is in use by an active restore"), {
      code: "CONFLICT",
    });
  }
  const row = input.control.getBackup(input.backupId);
  if (!row) {
    throw Object.assign(new Error("Backup not found"), { code: "NOT_FOUND" });
  }
  const abs = resolveCatalogFile(resolveBackupDir(input.backupDir), row);
  input.control.deleteBackup(input.backupId);
  if (abs && fs.existsSync(abs)) {
    fs.rmSync(abs, { force: true });
  }
}

export function verifyCatalogBackupFile(
  backupDir: string,
  row: HouseholdBackupRow,
): { absPath: string } | { error: BackupAdmissionError } {
  const abs = resolveCatalogFile(resolveBackupDir(backupDir), row);
  if (!abs || !fs.existsSync(abs)) {
    return { error: { code: "NOT_FOUND", message: "Backup file is missing" } };
  }
  const digest = fileSha256Hex(abs);
  if (digest !== row.contentDigest) {
    return { error: { code: "CORRUPT", message: "Backup digest does not match catalog" } };
  }
  const inspected = inspectHouseholdImage(abs);
  if (!inspected.ok) return { error: inspected.error };
  return { absPath: abs };
}

/** Stage a disposable candidate from a catalog backup; never rewrite the source. */
export async function stageRestoreCandidate(input: {
  sourceAbs: string;
  candidateAbs: string;
}): Promise<void> {
  fs.mkdirSync(path.dirname(input.candidateAbs), { recursive: true });
  for (const target of [
    input.candidateAbs,
    `${input.candidateAbs}-wal`,
    `${input.candidateAbs}-shm`,
  ]) {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      /* ignore */
    }
  }
  const src = openReadonly(input.sourceAbs);
  try {
    await src.backup(input.candidateAbs);
  } finally {
    src.close();
  }
  const prepared = openDatabase(input.candidateAbs);
  try {
    migrate(prepared);
    scrubRestoredAccess(prepared);
  } finally {
    prepared.close();
  }
}

/** Invalidate bearer access in a staged household image before activation. */
export function scrubRestoredAccess(db: Database.Database): void {
  const now = new Date().toISOString();
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
  const has = (name: string) => tables.includes(name);

  if (has("auth_sessions")) {
    db.prepare(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)`).run(now);
  }
  if (has("display_sessions")) {
    db.prepare(`UPDATE display_sessions SET revoked_at = COALESCE(revoked_at, ?)`).run(now);
  }
  if (has("enrollment_claims")) {
    db.prepare(`UPDATE enrollment_claims SET consumed_at = COALESCE(consumed_at, ?)`).run(now);
  }
  if (has("display_enrollment_claims")) {
    db.prepare(
      `UPDATE display_enrollment_claims SET revoked_at = COALESCE(revoked_at, ?)
       WHERE consumed_at IS NULL`,
    ).run(now);
  }
  // Bump session/auth versions when columns exist so restored cookies cannot reuse authority.
  if (has("users")) {
    try {
      db.prepare(
        `UPDATE users SET credential_version = COALESCE(credential_version, 0) + 1`,
      ).run();
    } catch {
      /* column may not exist on older schemas before migrate finishes */
    }
  }
  if (has("household_memberships")) {
    try {
      db.prepare(
        `UPDATE household_memberships
         SET access_version = COALESCE(access_version, 0) + 1`,
      ).run();
    } catch {
      /* optional column */
    }
  }
}

export function readActiveHouseholdIdentity(activeDbPath: string): {
  householdId: string | null;
  householdName: string | null;
} {
  if (!fs.existsSync(activeDbPath)) {
    return { householdId: null, householdName: null };
  }
  const db = openReadonly(activeDbPath);
  try {
    const row = db
      .prepare(`SELECT id, name FROM households ORDER BY id LIMIT 1`)
      .get() as { id: string; name: string } | undefined;
    return {
      householdId: row?.id ?? null,
      householdName: row?.name ?? null,
    };
  } catch {
    return { householdId: null, householdName: null };
  } finally {
    db.close();
  }
}

export function buildRestorePreview(input: {
  meta: BackupPublicMeta;
  activeDbPath: string;
}): BackupPreview {
  const current = readActiveHouseholdIdentity(input.activeDbPath);
  return {
    ...input.meta,
    currentHouseholdId: current.householdId,
    currentHouseholdName: current.householdName,
    replacesCurrent: Boolean(current.householdId),
    notes: [
      "People, credentials, permissions, work, calendar, and setup progress return to this snapshot.",
      "Passwords revert to the saved credential state; sign in with a restored manager password or use owner recovery.",
      "All current sign-in sessions, display enrollments, and invitations are retired. Walls need a new setup code.",
      "A fresh installation epoch is allocated; old offline queues cannot apply to the restored household.",
    ],
  };
}

export function assertSafeLegacyCandidate(input: {
  backupDir: string;
  requestedName: string;
  controlPath: string;
  activeDbPath: string;
  activeDbRelativePath: string;
}): string {
  const backupDir = resolveBackupDir(input.backupDir);
  const base = path.basename(input.requestedName);
  if (base !== input.requestedName || base.includes("..") || base.includes("/") || base.includes("\\")) {
    throw Object.assign(new Error("Unsafe backup file name"), { code: "VALIDATION" });
  }
  const abs = path.resolve(backupDir, base);
  const root = path.resolve(backupDir) + path.sep;
  if (!abs.startsWith(root)) {
    throw Object.assign(new Error("Backup path escapes BACKUP_DIR"), { code: "VALIDATION" });
  }
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    throw Object.assign(new Error("Backup file not found"), { code: "NOT_FOUND" });
  }
  if (st.isSymbolicLink()) {
    const real = fs.realpathSync(abs);
    if (!(real.startsWith(root) || real === path.resolve(backupDir))) {
      throw Object.assign(new Error("Symlink target is outside BACKUP_DIR"), {
        code: "VALIDATION",
      });
    }
  }
  if (!st.isFile() && !st.isSymbolicLink()) {
    throw Object.assign(new Error("Backup path is not a regular file"), { code: "VALIDATION" });
  }
  const realAbs = fs.realpathSync(abs);
  const forbidden = new Set(
    [
      path.resolve(input.controlPath),
      path.resolve(input.activeDbPath),
      resolveActiveDbAbsolutePath(input.activeDbRelativePath),
    ].map((p) => path.normalize(p)),
  );
  if (forbidden.has(path.normalize(realAbs))) {
    throw Object.assign(new Error("Control or active database cannot be registered as a backup"), {
      code: "VALIDATION",
    });
  }
  return realAbs;
}

export function listLegacyBackupCandidates(backupDir: string): Array<{
  fileName: string;
  byteSize: number;
  mtimeUtc: string;
}> {
  const root = resolveBackupDir(backupDir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => /^household-.*\.sqlite$/i.test(name))
    .map((fileName) => {
      const abs = path.join(root, fileName);
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) return null;
        return {
          fileName,
          byteSize: st.size,
          mtimeUtc: st.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}
