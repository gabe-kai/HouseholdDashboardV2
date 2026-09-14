import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SEED } from "../../src/server/seeds/evaluation.js";
import { backfillAuthenticatedAuthority } from "../../src/server/backfill.js";
import { backfillGroupMembershipBaselines } from "../../src/server/backfill-group-membership.js";
import { migrate, openDatabase } from "../../src/server/db.js";

/**
 * Populated pre-P0-005 / P0-004B-shaped baseline for upgrade tests.
 * Builds schema through 004, inserts representative data, then migrate() applies 005+.
 */
export const P004B_FIXTURE_IDS = {
  householdId: SEED.household.id,
  morganId: SEED.members[0]!.id,
  averyId: SEED.members[1]!.id,
  jordanId: SEED.members[2]!.id,
  caseyId: SEED.members[3]!.id,
  definitionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  groupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0",
  personalRevisionId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc0",
  proposalApprovedId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd0",
  proposalPendingId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  occurrenceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0",
} as const;

export function openPopulatedP004BUpgradeDatabase(dbPath: string, timezone = "America/New_York") {
  const db = openDatabase(dbPath);
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const through004 = [
    "001_initial.sql",
    "002_authenticated_authority.sql",
    "003_people_groups_access.sql",
    "004_group_backed_morning_routine.sql",
  ];
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  for (const file of through004) {
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

  const now = "2026-09-10T15:00:00.000Z";
  const ids = P004B_FIXTURE_IDS;
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

    db.prepare(
      "INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')",
    ).run(ids.definitionId, ids.householdId);
    db.prepare(
      `INSERT INTO routine_revisions (id, definition_id, effective_date, title, weekdays_json, created_at)
       VALUES (?, ?, '2026-09-01', 'Morning Routine', ?, ?)`,
    ).run(ids.revisionId, ids.definitionId, JSON.stringify([1, 2, 3, 4, 5, 6, 7]), now);
    db.prepare(
      `INSERT INTO revision_steps (id, revision_id, position, text, obligation, logical_item_id)
       VALUES (?, ?, 0, 'Make bed', 'required', ?)`,
    ).run(randomUUID(), ids.revisionId, randomUUID());
    db.prepare("INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)").run(
      ids.revisionId,
      ids.averyId,
    );

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
    db.prepare(
      "INSERT INTO group_membership_version_members (version_id, membership_id) VALUES (?, ?)",
    ).run(gVersionId, ids.averyId);
    db.prepare(
      "INSERT INTO group_membership_version_members (version_id, membership_id) VALUES (?, ?)",
    ).run(gVersionId, ids.jordanId);
    const gVersion2 = randomUUID();
    db.prepare(
      `INSERT INTO group_membership_versions (id, group_id, version, effective_date, created_at)
       VALUES (?, ?, 2, '2026-09-11', ?)`,
    ).run(gVersion2, ids.groupId, now);
    for (const memberId of [ids.averyId, ids.jordanId, ids.caseyId]) {
      db.prepare(
        "INSERT INTO group_membership_version_members (version_id, membership_id) VALUES (?, ?)",
      ).run(gVersion2, memberId);
    }
    db.prepare(
      "INSERT INTO revision_group_sources (revision_id, group_id) VALUES (?, ?)",
    ).run(ids.revisionId, ids.groupId);

    db.prepare(
      `INSERT INTO personal_routine_revisions (id, membership_id, definition_id, effective_date, created_at)
       VALUES (?, ?, ?, '2026-09-08', ?)`,
    ).run(ids.personalRevisionId, ids.averyId, ids.definitionId, now);
    db.prepare(
      `INSERT INTO personal_additions
         (id, personal_revision_id, position, text, obligation, anchor_logical_item_id, place)
       VALUES (?, ?, 0, 'Brush hair', 'optional', NULL, 'end')`,
    ).run(randomUUID(), ids.personalRevisionId);

    db.prepare(
      `INSERT INTO routine_proposals
         (id, household_id, membership_id, text, obligation, place, status, proposed_at, decided_at, personal_revision_id)
       VALUES (?, ?, ?, 'Pack violin', 'as_needed', 'end', 'approved', ?, ?, ?)`,
    ).run(
      ids.proposalApprovedId,
      ids.householdId,
      ids.averyId,
      now,
      now,
      ids.personalRevisionId,
    );
    db.prepare(
      `INSERT INTO routine_proposals
         (id, household_id, membership_id, text, obligation, place, status, proposed_at)
       VALUES (?, ?, ?, 'Read 10 minutes', 'optional', 'end', 'pending', ?)`,
    ).run(ids.proposalPendingId, ids.householdId, ids.averyId, now);

    db.prepare(
      `INSERT INTO occurrences
         (id, household_id, definition_id, revision_id, household_date, accountable_member_id, title, schedule_anchor, version)
       VALUES (?, ?, ?, ?, '2026-09-10', ?, 'Morning Routine', 'morning', 1)`,
    ).run(ids.occurrenceId, ids.householdId, ids.definitionId, ids.revisionId, ids.averyId);
    db.prepare(
      `INSERT INTO occurrence_steps (id, occurrence_id, position, text, obligation, status)
       VALUES (?, ?, 0, 'Make bed', 'required', 'completed')`,
    ).run(randomUUID(), ids.occurrenceId);
  } finally {
    db.pragma("foreign_keys = ON");
  }

  migrate(db);
  return db;
}
