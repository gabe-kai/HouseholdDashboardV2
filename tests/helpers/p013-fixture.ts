/**
 * Populated through-013 baseline for P0-007B upgrade tests.
 * Applies schema through 013; callers run migrate() for 014+.
 *
 * Includes representative fixed Cats/Trash responsibilities with started/history,
 * future rows, receipts, and the P0-010 reset generation/floor surface.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  openPopulatedP010UpgradeDatabase,
  P010_FIXTURE_IDS,
} from "./p010-fixture.js";

export const P013_FIXTURE_IDS = {
  ...P010_FIXTURE_IDS,
  catsDefinitionId: "cccccccc-cccc-4ccc-8ccc-cccccccccc01",
  catsRevisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccc02",
  catsScheduleId: "cccccccc-cccc-4ccc-8ccc-cccccccccc03",
  catsOccStartedId: "cccccccc-cccc-4ccc-8ccc-cccccccccc04",
  catsOccPastId: "cccccccc-cccc-4ccc-8ccc-cccccccccc05",
  catsOccFutureId: "cccccccc-cccc-4ccc-8ccc-cccccccccc06",
  catsStepFeedId: "cccccccc-cccc-4ccc-8ccc-cccccccccc07",
  catsStepWaterId: "cccccccc-cccc-4ccc-8ccc-cccccccccc08",
  catsStartedStepId: "cccccccc-cccc-4ccc-8ccc-cccccccccc09",
  catsCreateReceiptId: "cccccccc-cccc-4ccc-8ccc-cccccccccc0a",
  trashDefinitionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  trashRevisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
  trashScheduleId: "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
  trashOccPastId: "dddddddd-dddd-4ddd-8ddd-dddddddddd04",
  trashStepTakeOutId: "dddddddd-dddd-4ddd-8ddd-dddddddddd05",
  trashStepRecyclingId: "dddddddd-dddd-4ddd-8ddd-dddddddddd06",
  trashCreateReceiptId: "dddddddd-dddd-4ddd-8ddd-dddddddddd07",
} as const;

const THROUGH_013 = [
  "011_household_responsibilities.sql",
  "012_responsibility_integrity.sql",
  "013_definition_kind_and_owner_integrity.sql",
] as const;

/** Apply forward migrations 011–013 only (leaves 014+ for upgrade proofs). */
export function applyMigrations011Through013(db: Database.Database): void {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: string }).id),
  );
  db.pragma("foreign_keys = OFF");
  try {
    for (const file of THROUGH_013) {
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

function insertResponsibilityFixture(db: Database.Database): void {
  const ids = P013_FIXTURE_IDS;
  const now = "2026-09-10T16:30:00.000Z";
  const effectiveDate = "2026-09-01";

  db.prepare(
    `INSERT INTO routine_definitions
       (id, household_id, version, archived_at, archive_cutoff_date, ended_at, end_mode,
        deleted_at, created_at, kind)
     VALUES (?, ?, 1, NULL, NULL, NULL, NULL, NULL, ?, 'responsibility')`,
  ).run(ids.catsDefinitionId, ids.householdId, now);
  db.prepare(
    `INSERT INTO routine_revisions
       (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
     VALUES (?, ?, ?, 'Cats', ?, 'anytime', ?)`,
  ).run(
    ids.catsRevisionId,
    ids.catsDefinitionId,
    effectiveDate,
    JSON.stringify([1, 2, 3, 4, 5, 6, 7]),
    now,
  );
  db.prepare(
    `INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)`,
  ).run(ids.catsRevisionId, ids.averyId);
  db.prepare(
    `INSERT INTO revision_steps
       (id, revision_id, position, text, obligation, logical_item_id, applicability_json)
     VALUES (?, ?, 0, 'Feed cats', 'required', ?, ?),
            (?, ?, 1, 'Refresh water', 'required', ?, ?)`,
  ).run(
    randomUUID(),
    ids.catsRevisionId,
    ids.catsStepFeedId,
    JSON.stringify({ kind: "every_time" }),
    randomUUID(),
    ids.catsRevisionId,
    ids.catsStepWaterId,
    JSON.stringify({ kind: "every_time" }),
  );
  db.prepare(
    `INSERT INTO routine_schedule_entries
       (id, definition_id, start_date, revision_id, canceled_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(ids.catsScheduleId, ids.catsDefinitionId, effectiveDate, ids.catsRevisionId, now);

  db.prepare(
    `INSERT INTO routine_definitions
       (id, household_id, version, archived_at, archive_cutoff_date, ended_at, end_mode,
        deleted_at, created_at, kind)
     VALUES (?, ?, 1, NULL, NULL, NULL, NULL, NULL, ?, 'responsibility')`,
  ).run(ids.trashDefinitionId, ids.householdId, now);
  db.prepare(
    `INSERT INTO routine_revisions
       (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
     VALUES (?, ?, ?, 'Trash & Recycling', ?, 'evening', ?)`,
  ).run(
    ids.trashRevisionId,
    ids.trashDefinitionId,
    effectiveDate,
    JSON.stringify([2]),
    now,
  );
  db.prepare(
    `INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)`,
  ).run(ids.trashRevisionId, ids.averyId);
  db.prepare(
    `INSERT INTO revision_steps
       (id, revision_id, position, text, obligation, logical_item_id, applicability_json)
     VALUES (?, ?, 0, 'Take out trash', 'required', ?, ?),
            (?, ?, 1, 'Set recycling', 'required', ?, ?)`,
  ).run(
    randomUUID(),
    ids.trashRevisionId,
    ids.trashStepTakeOutId,
    JSON.stringify({ kind: "every_time" }),
    randomUUID(),
    ids.trashRevisionId,
    ids.trashStepRecyclingId,
    JSON.stringify({ kind: "every_time" }),
  );
  db.prepare(
    `INSERT INTO routine_schedule_entries
       (id, definition_id, start_date, revision_id, canceled_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(ids.trashScheduleId, ids.trashDefinitionId, effectiveDate, ids.trashRevisionId, now);

  // Past unstarted Cats history.
  db.prepare(
    `INSERT INTO occurrences
       (id, household_id, definition_id, revision_id, household_date,
        accountable_member_id, title, daypart, version, started_at, canceled_at, kind)
     VALUES (?, ?, ?, ?, '2026-09-09', ?, 'Cats', 'anytime', 1, NULL, NULL, 'responsibility')`,
  ).run(
    ids.catsOccPastId,
    ids.householdId,
    ids.catsDefinitionId,
    ids.catsRevisionId,
    ids.averyId,
  );
  db.prepare(
    `INSERT INTO occurrence_steps
       (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
     VALUES (?, ?, 0, 'Feed cats', 'required', 'open', 'shared', ?),
            (?, ?, 1, 'Refresh water', 'required', 'open', 'shared', ?)`,
  ).run(
    randomUUID(),
    ids.catsOccPastId,
    ids.catsStepFeedId,
    randomUUID(),
    ids.catsOccPastId,
    ids.catsStepWaterId,
  );

  // Started today Cats with report.
  db.prepare(
    `INSERT INTO occurrences
       (id, household_id, definition_id, revision_id, household_date,
        accountable_member_id, title, daypart, version, started_at, canceled_at, kind)
     VALUES (?, ?, ?, ?, '2026-09-10', ?, 'Cats', 'anytime', 1, ?, NULL, 'responsibility')`,
  ).run(
    ids.catsOccStartedId,
    ids.householdId,
    ids.catsDefinitionId,
    ids.catsRevisionId,
    ids.averyId,
    now,
  );
  db.prepare(
    `INSERT INTO occurrence_steps
       (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
     VALUES (?, ?, 0, 'Feed cats', 'required', 'completed', 'shared', ?),
            (?, ?, 1, 'Refresh water', 'required', 'open', 'shared', ?)`,
  ).run(
    ids.catsStartedStepId,
    ids.catsOccStartedId,
    ids.catsStepFeedId,
    randomUUID(),
    ids.catsOccStartedId,
    ids.catsStepWaterId,
  );
  db.prepare(
    `INSERT INTO step_reports
       (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id,
        acting_member_id, performer_member_id, performed_at, recorded_at, resulting_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
  ).run(
    randomUUID(),
    randomUUID(),
    ids.catsOccStartedId,
    ids.catsStartedStepId,
    ids.averyId,
    ids.averyId,
    ids.averyId,
    now,
    now,
  );

  // Future unstarted Cats.
  db.prepare(
    `INSERT INTO occurrences
       (id, household_id, definition_id, revision_id, household_date,
        accountable_member_id, title, daypart, version, started_at, canceled_at, kind)
     VALUES (?, ?, ?, ?, '2026-09-11', ?, 'Cats', 'anytime', 1, NULL, NULL, 'responsibility')`,
  ).run(
    ids.catsOccFutureId,
    ids.householdId,
    ids.catsDefinitionId,
    ids.catsRevisionId,
    ids.averyId,
  );
  db.prepare(
    `INSERT INTO occurrence_steps
       (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
     VALUES (?, ?, 0, 'Feed cats', 'required', 'open', 'shared', ?),
            (?, ?, 1, 'Refresh water', 'required', 'open', 'shared', ?)`,
  ).run(
    randomUUID(),
    ids.catsOccFutureId,
    ids.catsStepFeedId,
    randomUUID(),
    ids.catsOccFutureId,
    ids.catsStepWaterId,
  );

  // Past Tuesday Trash (unstarted history).
  db.prepare(
    `INSERT INTO occurrences
       (id, household_id, definition_id, revision_id, household_date,
        accountable_member_id, title, daypart, version, started_at, canceled_at, kind)
     VALUES (?, ?, ?, ?, '2026-09-09', ?, 'Trash & Recycling', 'evening', 1, NULL, NULL, 'responsibility')`,
  ).run(
    ids.trashOccPastId,
    ids.householdId,
    ids.trashDefinitionId,
    ids.trashRevisionId,
    ids.averyId,
  );
  db.prepare(
    `INSERT INTO occurrence_steps
       (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
     VALUES (?, ?, 0, 'Take out trash', 'required', 'open', 'shared', ?),
            (?, ?, 1, 'Set recycling', 'required', 'open', 'shared', ?)`,
  ).run(
    randomUUID(),
    ids.trashOccPastId,
    ids.trashStepTakeOutId,
    randomUUID(),
    ids.trashOccPastId,
    ids.trashStepRecyclingId,
  );

  db.prepare(
    `INSERT INTO routine_mutation_receipts
       (mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at)
     VALUES (?, ?, ?, 'responsibility_create', ?, ?, ?),
            (?, ?, ?, 'responsibility_create', ?, ?, ?)`,
  ).run(
    ids.catsCreateReceiptId,
    ids.householdId,
    ids.catsDefinitionId,
    randomUUID(),
    JSON.stringify({ id: ids.catsDefinitionId, title: "Cats" }),
    now,
    ids.trashCreateReceiptId,
    ids.householdId,
    ids.trashDefinitionId,
    randomUUID(),
    JSON.stringify({ id: ids.trashDefinitionId, title: "Trash & Recycling" }),
    now,
  );
}

/** Open disposable DB with schema through 013 and populated representative rows. */
export function openPopulatedP013UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP010UpgradeDatabase(dbPath, timezone);
  db.pragma("foreign_keys = OFF");
  try {
    applyMigrations011Through013(db);
    insertResponsibilityFixture(db);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}
