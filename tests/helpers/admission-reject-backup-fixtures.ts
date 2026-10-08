/**
 * Disposable negative household images for P0-008B AT6 restore-admission proofs.
 * Each file is a valid SQLite DB that inspectHouseholdImage must reject before
 * catalog publish / activation.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { createThrough017BackupFile } from "./through-017-backup-fixture.js";

async function copyViaBackupApi(sourceAbs: string, destAbs: string): Promise<void> {
  const src = new Database(sourceAbs, { readonly: true, fileMustExist: true });
  try {
    await src.backup(destAbs);
  } finally {
    src.close();
  }
}

async function baseThrough017Copy(backupDir: string, fileName: string): Promise<string> {
  const base = await createThrough017BackupFile(backupDir);
  const dest = path.join(backupDir, fileName);
  if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  await copyViaBackupApi(base.absPath, dest);
  return dest;
}

/** Schema history includes a migration id the running app does not ship. */
export async function createNewerThanAppBackupFile(backupDir: string): Promise<{
  fileName: string;
  absPath: string;
}> {
  const fileName = `reject-newer-${Date.now().toString(36)}.sqlite`;
  const absPath = await baseThrough017Copy(backupDir, fileName);
  const db = new Database(absPath);
  try {
    db.prepare(
      `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
    ).run("999_future_unsupported_feature.sql", new Date().toISOString());
  } finally {
    db.close();
  }
  return { fileName, absPath };
}

/** No schema_migrations table — unknown / unrecognizable schema history. */
export function createUnknownSchemaBackupFile(backupDir: string): {
  fileName: string;
  absPath: string;
} {
  fs.mkdirSync(backupDir, { recursive: true });
  const fileName = `reject-unknown-${Date.now().toString(36)}.sqlite`;
  const absPath = path.join(backupDir, fileName);
  const db = new Database(absPath);
  try {
    db.exec(`
      CREATE TABLE households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        timezone TEXT NOT NULL
      );
      INSERT INTO households (id, name, timezone)
      VALUES ('${randomUUID()}', 'Unknown Schema Household', 'America/New_York');
    `);
  } finally {
    db.close();
  }
  return { fileName, absPath };
}

/** Two household rows — multi-household images are unsupported. */
export async function createMultiHouseholdBackupFile(backupDir: string): Promise<{
  fileName: string;
  absPath: string;
}> {
  const fileName = `reject-multi-${Date.now().toString(36)}.sqlite`;
  const absPath = await baseThrough017Copy(backupDir, fileName);
  const db = new Database(absPath);
  try {
    db.prepare(
      `INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)`,
    ).run(randomUUID(), "Second Household", "America/Chicago");
  } finally {
    db.close();
  }
  return { fileName, absPath };
}
