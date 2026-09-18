/**
 * Populated through-009 baseline for P0-006C upgrade tests.
 * Applies schema through 009; callers run migrate() for 010+.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SEED } from "../../src/server/seeds/evaluation.js";
import { openPopulatedP008UpgradeDatabase, P008_FIXTURE_IDS } from "./p008-fixture.js";

export const P009_FIXTURE_IDS = {
  ...P008_FIXTURE_IDS,
  calendarEditionId: "99999999-9999-4999-8999-999999999901",
  calendarYearId: "99999999-9999-4999-8999-999999999902",
  emptyOccurrenceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
} as const;

/** Open disposable DB with schema through 009 and populated representative rows. */
export function openPopulatedP009UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP008UpgradeDatabase(dbPath, timezone);
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const file = "009_contextual_routine_applicability.sql";
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
      file,
      new Date().toISOString(),
    );

    const ids = P009_FIXTURE_IDS;
    const now = "2026-09-10T15:00:00.000Z";
    db.prepare(
      `INSERT INTO household_calendars (household_id, version, updated_at) VALUES (?, 1, ?)`,
    ).run(ids.householdId, now);
    db.prepare(
      `INSERT INTO school_calendar_editions
         (id, household_id, version, effective_from, created_at, mutation_id)
       VALUES (?, ?, 1, '2026-09-01', ?, ?)`,
    ).run(ids.calendarEditionId, ids.householdId, now, randomUUID());
    db.prepare(
      `INSERT INTO school_years
         (id, edition_id, start_date, end_date, usual_weekdays_json, position)
       VALUES (?, ?, '2026-09-01', '2027-06-15', ?, 0)`,
    ).run(ids.calendarYearId, ids.calendarEditionId, JSON.stringify([1, 2, 3, 4, 5]));

    // Empty unstarted occurrence for visibility/filter coverage.
    db.prepare(
      `INSERT INTO occurrences
         (id, household_id, definition_id, revision_id, household_date,
          accountable_member_id, title, daypart, version, started_at, calendar_edition_id, calendar_provenance)
       VALUES (?, ?, ?, ?, '2026-09-09', ?, 'Empty Past', 'morning', 1, NULL, ?, 'edition')`,
    ).run(
      ids.emptyOccurrenceId,
      ids.householdId,
      ids.definitionId,
      ids.revisionId,
      ids.jordanId,
      ids.calendarEditionId,
    );
  } finally {
    db.pragma("foreign_keys = ON");
  }
  void SEED;
  return db;
}
