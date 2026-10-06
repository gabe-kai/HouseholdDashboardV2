/**
 * Populated through-017 baseline for P0-008A adoption tests.
 * Applies schema through 017; callers run migrate() for 018+.
 *
 * Builds on through-016 (display provenance + completed task extras), then applies
 * 017 so AT1 can prove identity/grant/data preservation across the lifecycle tip.
 */
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  openPopulatedP016UpgradeDatabase,
  P016_FIXTURE_IDS,
} from "./p016-fixture.js";

export const P017_FIXTURE_IDS = {
  ...P016_FIXTURE_IDS,
} as const;

const THROUGH_017 = ["017_personal_task_wall_promotion.sql"] as const;

/** Apply forward migration 017 only (leaves 018+ for upgrade proofs). */
export function applyMigration017(db: Database.Database): void {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: string }).id),
  );
  db.pragma("foreign_keys = OFF");
  try {
    for (const file of THROUGH_017) {
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

/** Open disposable DB with schema through 017 and populated representative rows. */
export function openPopulatedP017UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP016UpgradeDatabase(dbPath, timezone);
  db.pragma("foreign_keys = OFF");
  try {
    applyMigration017(db);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}
