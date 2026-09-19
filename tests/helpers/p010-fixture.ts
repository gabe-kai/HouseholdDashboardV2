/**
 * Populated through-010 baseline for P0-007A upgrade tests.
 * Applies schema through 010; callers run migrate() for 011+.
 */
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { openPopulatedP009UpgradeDatabase, P009_FIXTURE_IDS } from "./p009-fixture.js";

export const P010_FIXTURE_IDS = {
  ...P009_FIXTURE_IDS,
} as const;

/** Open disposable DB with schema through 010 and populated representative rows. */
export function openPopulatedP010UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP009UpgradeDatabase(dbPath, timezone);
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const file = "010_household_profiles_useful_history.sql";
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString(),
    );
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}
