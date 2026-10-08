/**
 * Stable disposable through-017 household image for P0-008B compatibility proofs.
 * Applies migrations 001–017 only (no 018+), seeds one household + manager, and
 * writes a SQLite-backup-API file under the given directory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { hashPassphrase } from "../../src/server/crypto.js";

const migrationsDir = path.resolve(process.cwd(), "db/migrations");

function listThrough017Migrations(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => f <= "017_personal_task_wall_promotion.sql");
}

export async function createThrough017BackupFile(backupDir: string): Promise<{
  fileName: string;
  absPath: string;
  householdId: string;
  householdName: string;
  sourceBytes: Buffer;
  schemaManifest: string[];
  loginName: string;
}> {
  fs.mkdirSync(backupDir, { recursive: true });
  const workPath = path.join(
    os.tmpdir(),
    `hd-through017-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  const db = new Database(workPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  for (const file of listThrough017Migrations()) {
    const already = db
      .prepare(`SELECT 1 AS ok FROM schema_migrations WHERE id = ?`)
      .get(file) as { ok: number } | undefined;
    if (already) continue;
    db.pragma("foreign_keys = OFF");
    try {
      const tx = db.transaction(() => {
        db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
        db.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(
          file,
          new Date().toISOString(),
        );
      });
      tx();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  const householdId = randomUUID();
  const householdName = "Through017 Household";
  const userId = randomUUID();
  const membershipId = randomUUID();
  const now = new Date().toISOString();
  const loginName = `t017_${Date.now().toString(36)}`;
  const passwordHash = await hashPassphrase("Unique-passphrase-ok!999");

  db.prepare(`INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)`).run(
    householdId,
    householdName,
    "America/New_York",
  );
  db.prepare(`INSERT INTO users (id, login_name, created_at, disabled) VALUES (?, ?, ?, 0)`).run(
    userId,
    loginName,
    now,
  );
  db.prepare(
    `INSERT INTO user_credentials (user_id, passphrase_phc, updated_at) VALUES (?, ?, ?)`,
  ).run(userId, passwordHash, now);
  db.prepare(
    `INSERT INTO household_memberships
     (id, household_id, user_id, display_name, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
  ).run(membershipId, householdId, userId, "Through017 Manager", now);
  for (const grant of ["member.enroll", "structure.manage", "household.lifecycle.manage"]) {
    db.prepare(
      `INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)`,
    ).run(membershipId, grant);
  }

  const schemaManifest = (
    db.prepare(`SELECT id FROM schema_migrations ORDER BY id`).all() as Array<{ id: string }>
  ).map((r) => r.id);
  if (!schemaManifest.includes("017_personal_task_wall_promotion.sql")) {
    throw new Error("through-017 fixture missing 017 migration");
  }
  if (schemaManifest.some((id) => id.startsWith("018_"))) {
    throw new Error("through-017 fixture unexpectedly includes 018+");
  }

  const fileName = `household-through017-${Date.now()}.sqlite`;
  const absPath = path.join(backupDir, fileName);
  await db.backup(absPath);
  db.close();
  for (const target of [workPath, `${workPath}-wal`, `${workPath}-shm`]) {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      /* ignore */
    }
  }

  return {
    fileName,
    absPath,
    householdId,
    householdName,
    sourceBytes: fs.readFileSync(absPath),
    schemaManifest,
    loginName,
  };
}
