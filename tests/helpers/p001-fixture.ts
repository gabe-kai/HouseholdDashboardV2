import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { SEED } from "../../src/server/seeds/evaluation.js";

/** Supported P0-003 migration baseline: representative populated pre-P0-002 schema. */
export const P001_FIXTURE_IDS = {
  definitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  stepIds: [
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  ],
  occurrenceId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  occStepIds: [
    "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
  ],
  reportId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  mutationId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
} as const;

export function applyPopulatedP001Fixture(db: Database.Database, timezone = "America/New_York") {
  const sql001 = fs.readFileSync(path.resolve(process.cwd(), "db/migrations/001_initial.sql"), "utf8");
  db.exec(sql001);
  db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
    "001_initial.sql",
    new Date().toISOString(),
  );

  db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)").run(
    SEED.household.id,
    SEED.household.name,
    timezone,
  );
  for (const member of SEED.members) {
    db.prepare(
      "INSERT INTO members (id, household_id, display_name, capabilities_json) VALUES (?, ?, ?, ?)",
    ).run(
      member.id,
      SEED.household.id,
      member.displayName,
      JSON.stringify([...member.capabilities]),
    );
  }

  const { definitionId, revisionId, stepIds, occurrenceId, occStepIds, reportId, mutationId } =
    P001_FIXTURE_IDS;

  db.prepare(
    "INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')",
  ).run(definitionId, SEED.household.id);
  db.prepare(
    `INSERT INTO routine_revisions (id, definition_id, effective_date, title, weekdays_json, created_at)
     VALUES (?, ?, '2026-09-01', 'Morning Routine', ?, ?)`,
  ).run(revisionId, definitionId, JSON.stringify([1, 2, 3, 4, 5, 6, 7]), new Date().toISOString());
  db.prepare(
    "INSERT INTO revision_steps (id, revision_id, position, text, obligation) VALUES (?, ?, 0, 'Make bed', 'required')",
  ).run(stepIds[0], revisionId);
  db.prepare(
    "INSERT INTO revision_steps (id, revision_id, position, text, obligation) VALUES (?, ?, 1, 'Stretch', 'optional')",
  ).run(stepIds[1], revisionId);
  db.prepare("INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)").run(
    revisionId,
    SEED.members[1].id,
  );
  db.prepare(
    `INSERT INTO occurrences
     (id, household_id, definition_id, revision_id, household_date, accountable_member_id, title, schedule_anchor, version)
     VALUES (?, ?, ?, ?, '2026-09-06', ?, 'Morning Routine', 'morning', 1)`,
  ).run(occurrenceId, SEED.household.id, definitionId, revisionId, SEED.members[1].id);
  db.prepare(
    `INSERT INTO occurrence_steps (id, occurrence_id, position, text, obligation, status)
     VALUES (?, ?, 0, 'Make bed', 'required', 'completed')`,
  ).run(occStepIds[0], occurrenceId);
  db.prepare(
    `INSERT INTO occurrence_steps (id, occurrence_id, position, text, obligation, status)
     VALUES (?, ?, 1, 'Stretch', 'optional', 'open')`,
  ).run(occStepIds[1], occurrenceId);
  db.prepare(
    `INSERT INTO step_reports
     (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id, acting_member_id, performed_at, recorded_at, resulting_state)
     VALUES (?, ?, ?, ?, ?, ?, '2026-09-06T12:00:00.000Z', '2026-09-06T12:00:01.000Z', 'completed')`,
  ).run(
    reportId,
    mutationId,
    occurrenceId,
    occStepIds[0],
    SEED.members[1].id,
    SEED.members[1].id,
  );
  db.prepare(
    "INSERT INTO sessions (id, household_id, member_id, created_at) VALUES (?, ?, ?, ?)",
  ).run("old-session", SEED.household.id, SEED.members[0].id, new Date().toISOString());
}
