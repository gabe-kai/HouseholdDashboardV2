import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { SEED } from "../../src/server/seeds/evaluation.js";
import { backfillAuthenticatedAuthority } from "../../src/server/backfill.js";
import { backfillGroupMembershipBaselines } from "../../src/server/backfill-group-membership.js";
import { openDatabase } from "../../src/server/db.js";

/**
 * Populated through-008 baseline for P0-006B upgrade tests.
 * Applies schema through 008 with rich representative data; callers run migrate() for 009+.
 */
export const P008_FIXTURE_IDS = {
  householdId: SEED.household.id,
  morganId: SEED.members[0]!.id,
  averyId: SEED.members[1]!.id,
  jordanId: SEED.members[2]!.id,
  caseyId: SEED.members[3]!.id,
  definitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  upcomingRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  endedDefinitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  endedRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
  scheduleCurrentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  scheduleUpcomingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  scheduleEndedId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
  groupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0",
  personalRevisionId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc0",
  proposalApprovedId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd0",
  proposalPendingId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  occurrencePastId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0",
  occurrenceTodayId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  occurrenceFutureId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
  occurrenceStartedId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
  stepLogicalId: "ffffffff-ffff-4fff-8fff-fffffffffff0",
  receiptMutationId: "ffffffff-ffff-4fff-8fff-fffffffffff1",
} as const;

const THROUGH_008 = [
  "001_initial.sql",
  "002_authenticated_authority.sql",
  "003_people_groups_access.sql",
  "004_group_backed_morning_routine.sql",
  "005_multiple_household_routines.sql",
  "006_occurrence_structural_lock.sql",
  "007_routine_schedule_lifecycle.sql",
  "008_widen_routine_mutation_receipt_kinds.sql",
] as const;

function applyThrough008(db: Database.Database): void {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  for (const file of THROUGH_008) {
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
    if (file.startsWith("002_")) backfillAuthenticatedAuthority(db);
    if (file.startsWith("004_")) backfillGroupMembershipBaselines(db);
  }
}

/** Open a disposable DB with schema through 008 and populated representative rows. */
export function openPopulatedP008UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openDatabase(dbPath);
  applyThrough008(db);

  const now = "2026-09-10T15:00:00.000Z";
  const ids = P008_FIXTURE_IDS;
  db.pragma("foreign_keys = OFF");
  try {
    db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)").run(
      ids.householdId,
      SEED.household.name,
      timezone,
    );
    for (const member of SEED.members) {
      db.prepare(
        `INSERT INTO household_memberships
           (id, household_id, display_name, status, classification, version, created_at)
         VALUES (?, ?, ?, 'pending', ?, 1, ?)`,
      ).run(
        member.id,
        ids.householdId,
        member.displayName,
        member.preset === "manager" ? "adult" : "child",
        now,
      );
    }
    // Manager holds shared.manage so 009 can backfill schedule.manage (no hand-run of 009 SQL).
    for (const grant of [
      "household.member.enroll",
      "household.structure.manage",
      "routine.shared.manage",
      "routine.proposal.decide",
      "routine.execute.own",
      "personal_task.create",
    ]) {
      db.prepare(
        "INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
      ).run(ids.morganId, grant);
    }
    for (const grant of [
      "routine.personalize.direct",
      "routine.execute.own",
      "personal_task.create",
    ]) {
      db.prepare(
        "INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
      ).run(ids.averyId, grant);
    }

    db.prepare(
      `INSERT INTO routine_definitions
         (id, household_id, version, archived_at, archive_cutoff_date, ended_at, end_mode, deleted_at, created_at)
       VALUES (?, ?, 2, NULL, NULL, NULL, NULL, NULL, ?)`,
    ).run(ids.definitionId, ids.householdId, now);
    db.prepare(
      `INSERT INTO routine_revisions
         (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
       VALUES (?, ?, '2026-09-01', 'Morning Routine', ?, 'morning', ?)`,
    ).run(ids.revisionId, ids.definitionId, JSON.stringify([1, 2, 3, 4, 5, 6, 7]), now);
    db.prepare(
      `INSERT INTO revision_steps (id, revision_id, position, text, obligation, logical_item_id)
       VALUES (?, ?, 0, 'Make bed', 'required', ?)`,
    ).run(randomUUID(), ids.revisionId, ids.stepLogicalId);
    db.prepare("INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)").run(
      ids.revisionId,
      ids.averyId,
    );
    db.prepare(
      `INSERT INTO routine_schedule_entries
         (id, definition_id, start_date, revision_id, canceled_at, created_at)
       VALUES (?, ?, '2026-09-01', ?, NULL, ?)`,
    ).run(ids.scheduleCurrentId, ids.definitionId, ids.revisionId, now);

    db.prepare(
      `INSERT INTO routine_revisions
         (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
       VALUES (?, ?, '2026-09-20', 'Morning Upcoming', ?, 'morning', ?)`,
    ).run(
      ids.upcomingRevisionId,
      ids.definitionId,
      JSON.stringify([1, 2, 3, 4, 5, 6, 7]),
      now,
    );
    db.prepare(
      `INSERT INTO revision_steps (id, revision_id, position, text, obligation, logical_item_id)
       VALUES (?, ?, 0, 'Upcoming bed', 'required', ?)`,
    ).run(randomUUID(), ids.upcomingRevisionId, randomUUID());
    db.prepare("INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)").run(
      ids.upcomingRevisionId,
      ids.averyId,
    );
    db.prepare(
      `INSERT INTO routine_schedule_entries
         (id, definition_id, start_date, revision_id, canceled_at, created_at)
       VALUES (?, ?, '2026-09-20', ?, NULL, ?)`,
    ).run(ids.scheduleUpcomingId, ids.definitionId, ids.upcomingRevisionId, now);

    db.prepare(
      `INSERT INTO routine_definitions
         (id, household_id, version, archived_at, archive_cutoff_date, ended_at, end_mode, deleted_at, created_at)
       VALUES (?, ?, 1, ?, '2026-09-05', ?, 'legacy_archive', NULL, ?)`,
    ).run(
      ids.endedDefinitionId,
      ids.householdId,
      now,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO routine_revisions
         (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
       VALUES (?, ?, '2026-08-01', 'Ended Routine', ?, 'evening', ?)`,
    ).run(ids.endedRevisionId, ids.endedDefinitionId, JSON.stringify([1, 2, 3, 4, 5]), now);
    db.prepare(
      `INSERT INTO revision_steps (id, revision_id, position, text, obligation, logical_item_id)
       VALUES (?, ?, 0, 'Old step', 'required', ?)`,
    ).run(randomUUID(), ids.endedRevisionId, randomUUID());
    db.prepare(
      `INSERT INTO routine_schedule_entries
         (id, definition_id, start_date, revision_id, canceled_at, created_at)
       VALUES (?, ?, '2026-08-01', ?, NULL, ?)`,
    ).run(ids.scheduleEndedId, ids.endedDefinitionId, ids.endedRevisionId, now);

    db.prepare(
      `INSERT INTO household_groups (id, household_id, name, version, created_at, updated_at)
       VALUES (?, ?, 'Kids', 1, ?, ?)`,
    ).run(ids.groupId, ids.householdId, now, now);
    db.prepare(
      "INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)",
    ).run(ids.groupId, ids.averyId);
    db.prepare(
      "INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)",
    ).run(ids.groupId, ids.jordanId);
    const gVersionId = `${ids.groupId}:v1`;
    db.prepare(
      `INSERT INTO group_membership_versions (id, group_id, version, effective_date, created_at)
       VALUES (?, ?, 1, '2026-09-10', ?)`,
    ).run(gVersionId, ids.groupId, now);
    for (const memberId of [ids.averyId, ids.jordanId]) {
      db.prepare(
        "INSERT INTO group_membership_version_members (version_id, membership_id) VALUES (?, ?)",
      ).run(gVersionId, memberId);
    }
    db.prepare(
      "INSERT INTO revision_group_sources (revision_id, group_id) VALUES (?, ?)",
    ).run(ids.revisionId, ids.groupId);

    db.prepare(
      `INSERT INTO personal_routine_revisions
         (id, membership_id, definition_id, effective_date, created_at)
       VALUES (?, ?, ?, '2026-09-08', ?)`,
    ).run(ids.personalRevisionId, ids.averyId, ids.definitionId, now);
    db.prepare(
      `INSERT INTO personal_additions
         (id, personal_revision_id, position, text, obligation, anchor_logical_item_id, place)
       VALUES (?, ?, 0, 'Brush hair', 'optional', ?, 'after')`,
    ).run(randomUUID(), ids.personalRevisionId, ids.stepLogicalId);

    db.prepare(
      `INSERT INTO routine_proposals
         (id, household_id, membership_id, definition_id, text, obligation, place, status,
          proposed_at, decided_at, personal_revision_id, association_status)
       VALUES (?, ?, ?, ?, 'Pack violin', 'as_needed', 'end', 'approved', ?, ?, ?, 'resolved')`,
    ).run(
      ids.proposalApprovedId,
      ids.householdId,
      ids.averyId,
      ids.definitionId,
      now,
      now,
      ids.personalRevisionId,
    );
    db.prepare(
      `INSERT INTO routine_proposals
         (id, household_id, membership_id, definition_id, text, obligation, place, status,
          proposed_at, association_status)
       VALUES (?, ?, ?, ?, 'Read 10 minutes', 'optional', 'end', 'pending', ?, 'resolved')`,
    ).run(
      ids.proposalPendingId,
      ids.householdId,
      ids.averyId,
      ids.definitionId,
      now,
    );

    db.prepare(
      `INSERT INTO occurrences
         (id, household_id, definition_id, revision_id, household_date, accountable_member_id,
          title, daypart, version, started_at, canceled_at)
       VALUES (?, ?, ?, ?, '2026-09-09', ?, 'Morning Routine', 'morning', 1, NULL, NULL)`,
    ).run(ids.occurrencePastId, ids.householdId, ids.definitionId, ids.revisionId, ids.averyId);
    db.prepare(
      `INSERT INTO occurrence_steps
         (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
       VALUES (?, ?, 0, 'Make bed', 'required', 'open', 'shared', ?)`,
    ).run(randomUUID(), ids.occurrencePastId, ids.stepLogicalId);

    db.prepare(
      `INSERT INTO occurrences
         (id, household_id, definition_id, revision_id, household_date, accountable_member_id,
          title, daypart, version, started_at, canceled_at)
       VALUES (?, ?, ?, ?, '2026-09-10', ?, 'Morning Routine', 'morning', 1, NULL, NULL)`,
    ).run(ids.occurrenceTodayId, ids.householdId, ids.definitionId, ids.revisionId, ids.averyId);
    db.prepare(
      `INSERT INTO occurrence_steps
         (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
       VALUES (?, ?, 0, 'Make bed', 'required', 'open', 'shared', ?)`,
    ).run(randomUUID(), ids.occurrenceTodayId, ids.stepLogicalId);

    db.prepare(
      `INSERT INTO occurrences
         (id, household_id, definition_id, revision_id, household_date, accountable_member_id,
          title, daypart, version, started_at, canceled_at)
       VALUES (?, ?, ?, ?, '2026-09-21', ?, 'Morning Upcoming', 'morning', 1, NULL, NULL)`,
    ).run(
      ids.occurrenceFutureId,
      ids.householdId,
      ids.definitionId,
      ids.upcomingRevisionId,
      ids.averyId,
    );
    db.prepare(
      `INSERT INTO occurrence_steps
         (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
       VALUES (?, ?, 0, 'Upcoming bed', 'required', 'open', 'shared', ?)`,
    ).run(randomUUID(), ids.occurrenceFutureId, randomUUID());

    db.prepare(
      `INSERT INTO occurrences
         (id, household_id, definition_id, revision_id, household_date, accountable_member_id,
          title, daypart, version, started_at, canceled_at)
       VALUES (?, ?, ?, ?, '2026-09-10', ?, 'Morning Routine', 'morning', 2, ?, NULL)`,
    ).run(
      ids.occurrenceStartedId,
      ids.householdId,
      ids.definitionId,
      ids.revisionId,
      ids.jordanId,
      now,
    );
    const startedStepId = randomUUID();
    db.prepare(
      `INSERT INTO occurrence_steps
         (id, occurrence_id, position, text, obligation, status, source, logical_item_id)
       VALUES (?, ?, 0, 'Make bed', 'required', 'completed', 'shared', ?)`,
    ).run(startedStepId, ids.occurrenceStartedId, ids.stepLogicalId);
    db.prepare(
      `INSERT INTO step_reports
         (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id,
          acting_member_id, performed_at, recorded_at, resulting_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')`,
    ).run(
      randomUUID(),
      randomUUID(),
      ids.occurrenceStartedId,
      startedStepId,
      ids.jordanId,
      ids.jordanId,
      now,
      now,
    );

    db.prepare(
      `INSERT INTO routine_mutation_receipts
         (mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at)
       VALUES (?, ?, ?, 'routine_create', 'digest', '{}', ?)`,
    ).run(ids.receiptMutationId, ids.householdId, ids.definitionId, now);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  return db;
}
