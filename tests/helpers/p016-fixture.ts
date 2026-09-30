/**
 * Populated through-016 baseline for P0-007C-3B upgrade tests.
 * Applies schema through 016; callers run migrate() for 017+.
 *
 * Builds on through-015 (display + human report), then applies 016 so AT1 can
 * prove promotion defaults and completed_at backfill across 017.
 */
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  openPopulatedP015UpgradeDatabase,
  P015_FIXTURE_IDS,
} from "./p015-fixture.js";

export const P016_FIXTURE_IDS = {
  ...P015_FIXTURE_IDS,
  completedHouseholdTaskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
  taskStatusMutationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04",
} as const;

const THROUGH_016 = ["016_display_execution_provenance.sql"] as const;

/** Apply forward migration 016 only (leaves 017+ for upgrade proofs). */
export function applyMigration016(db: Database.Database): void {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: string }).id),
  );
  db.pragma("foreign_keys = OFF");
  try {
    for (const file of THROUGH_016) {
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

function insertTaskExtras(db: Database.Database): void {
  const ids = P016_FIXTURE_IDS;
  const completedAt = "2026-09-18T12:00:00.000Z";
  // Ensure a completed household-visible task exists for completedAt backfill proof.
  const existing = db
    .prepare(`SELECT 1 AS ok FROM personal_tasks WHERE id = ?`)
    .get(ids.completedHouseholdTaskId) as { ok: number } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO personal_tasks
         (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
       VALUES (?, ?, ?, 'Completed household chore', 'household', 'completed', ?, ?)`,
    ).run(
      ids.completedHouseholdTaskId,
      ids.householdId,
      ids.averyId,
      "2026-09-17T12:00:00.000Z",
      completedAt,
    );
  }
  const receipt = db
    .prepare(`SELECT 1 AS ok FROM personal_task_mutations WHERE mutation_id = ?`)
    .get(ids.taskStatusMutationId) as { ok: number } | undefined;
  if (!receipt) {
    db.prepare(
      `INSERT INTO personal_task_mutations
         (mutation_id, task_id, response_json, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      ids.taskStatusMutationId,
      ids.completedHouseholdTaskId,
      JSON.stringify({
        id: ids.completedHouseholdTaskId,
        status: "completed",
        visibility: "household",
      }),
      completedAt,
    );
  }
}

/** Open disposable DB with schema through 016 and populated representative rows. */
export function openPopulatedP016UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP015UpgradeDatabase(dbPath, timezone);
  db.pragma("foreign_keys = OFF");
  try {
    applyMigration016(db);
    insertTaskExtras(db);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}
