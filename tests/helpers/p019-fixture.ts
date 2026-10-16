/**
 * Populated through-019 baseline for P0-008D AT1 adoption proofs.
 * Applies schema through 019 (A+C tip) without 020/021; callers run migrate() for D.
 */
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  openPopulatedP017UpgradeDatabase,
  P017_FIXTURE_IDS,
} from "./p017-fixture.js";

export const P019_FIXTURE_IDS = {
  ...P017_FIXTURE_IDS,
} as const;

const THROUGH_019 = [
  "018_household_lifecycle.sql",
  "019_member_access_removal.sql",
] as const;

/** Apply forward migrations 018–019 only (leaves 020+ for upgrade proofs). */
export function applyMigrationsThrough019(db: Database.Database): void {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: string }).id),
  );
  db.pragma("foreign_keys = OFF");
  try {
    for (const file of THROUGH_019) {
      if (applied.has(file)) continue;
      db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString(),
      );
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

/**
 * Open disposable DB with schema through 019 and populated representative rows,
 * including optional A progress timestamps, a departed member marker when present,
 * and lifecycle grants from 018/019 backfill.
 */
export function openPopulatedP019UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP017UpgradeDatabase(dbPath, timezone);
  applyMigrationsThrough019(db);

  const household = db.prepare(`SELECT id FROM households LIMIT 1`).get() as
    | { id: string }
    | undefined;
  if (!household) return db;

  const manager = db
    .prepare(
      `SELECT hm.id AS membership_id, hm.user_id AS user_id
       FROM household_memberships hm
       INNER JOIN membership_grants mg ON mg.membership_id = hm.id
         AND mg.grant_name = 'household.lifecycle.manage'
       WHERE hm.departed_at IS NULL
       LIMIT 1`,
    )
    .get() as { membership_id: string; user_id: string | null } | undefined;

  const now = new Date().toISOString();
  const existing = db
    .prepare(`SELECT household_id FROM setup_progress WHERE household_id = ?`)
    .get(household.id) as { household_id: string } | undefined;

  if (!existing && manager) {
    db.prepare(
      `INSERT INTO setup_progress
       (household_id, account_completed_at, household_completed_at, membership_id, user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(household.id, now, now, manager.membership_id, manager.user_id, now);
  }

  // Mark one non-manager membership departed when available (C departure preservation).
  const other = db
    .prepare(
      `SELECT id FROM household_memberships
       WHERE household_id = ? AND id != ? AND departed_at IS NULL
       LIMIT 1`,
    )
    .get(household.id, manager?.membership_id ?? "") as { id: string } | undefined;
  if (other) {
    db.prepare(
      `UPDATE household_memberships
       SET departed_at = ?, departed_household_date = ?
       WHERE id = ? AND departed_at IS NULL`,
    ).run(now, "2025-01-15", other.id);
  }

  return db;
}
