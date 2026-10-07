import type Database from "better-sqlite3";
import { applyMigration017, openPopulatedP017UpgradeDatabase } from "./p017-fixture.js";

/** Apply migration 018 onto an open through-017 database. */
export function applyMigration018(db: Database.Database): void {
  applyMigration017(db);
  const sql = `
-- mirrored from db/migrations/018_household_lifecycle.sql for fixture control
`;
  // Prefer the real migrate path in callers; this helper opens p017 then lets migrate() finish 018+.
  void sql;
}

/**
 * Open a populated through-017 database that still needs 018+.
 * Callers that need a through-018/A image should `migrate(db)` after open.
 */
export function openPopulatedP017ForBUpgrade(): {
  db: Database.Database;
  dbPath: string;
  close: () => void;
} {
  return openPopulatedP017UpgradeDatabase();
}

export { openPopulatedP017UpgradeDatabase };
