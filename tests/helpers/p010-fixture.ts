/**
 * Populated through-010 baseline for P0-007A upgrade tests.
 * Applies schema through 010; callers run migrate() for 011+.
 *
 * Includes nonzero activity_generation / activity_reset_floor and an
 * activity_reset receipt so upgrade proofs exercise the reset surface.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { openPopulatedP009UpgradeDatabase, P009_FIXTURE_IDS } from "./p009-fixture.js";

export const P010_FIXTURE_IDS = {
  ...P009_FIXTURE_IDS,
  activityResetMutationId: "ffffffff-ffff-4fff-8fff-fffffffffff2",
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

    const ids = P010_FIXTURE_IDS;
    const now = "2026-09-10T16:00:00.000Z";
    const resetFloor = "2026-09-10";

    // Representative profile + nonzero generation/floor for upgrade proofs.
    db.prepare(
      `UPDATE household_memberships
       SET full_name = ?, birthday = ?, email = ?
       WHERE id = ?`,
    ).run("Morgan Reed", "1985-03-12", "morgan@example.test", ids.morganId);

    db.prepare(
      `UPDATE households
       SET activity_generation = 3,
           activity_reset_floor = ?,
           family_order_version = 2
       WHERE id = ?`,
    ).run(resetFloor, ids.householdId);

    const counts = {
      occurrences: 0,
      occurrenceSteps: 0,
      stepReports: 0,
      mutationReceipts: 0,
    };
    const clearResult = {
      activityGeneration: 3,
      activityResetFloor: resetFloor,
      counts,
    };
    db.prepare(
      `INSERT INTO activity_reset_receipts
         (mutation_id, household_id, kind, payload_digest, actor_membership_id,
          expected_generation, result_generation, reset_floor, counts_json,
          response_json, created_at)
       VALUES (?, ?, 'activity_clear', ?, ?, 2, 3, ?, ?, ?, ?)`,
    ).run(
      ids.activityResetMutationId,
      ids.householdId,
      randomUUID(),
      ids.morganId,
      resetFloor,
      JSON.stringify(counts),
      JSON.stringify(clearResult),
      now,
    );
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}
