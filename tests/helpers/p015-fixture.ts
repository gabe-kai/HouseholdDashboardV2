/**
 * Populated through-015 baseline for P0-007C-3A upgrade tests.
 * Applies schema through 015; callers run migrate() for 016+.
 *
 * Builds on through-014 (Cats/Trash + tasks + member session), then applies 015
 * and adds an enrolled display identity/session plus a human checklist report/receipt
 * so AT1 can prove actor provenance preservation across 016.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  openPopulatedP014UpgradeDatabase,
  P014_FIXTURE_IDS,
} from "./p014-fixture.js";

export const P015_FIXTURE_IDS = {
  ...P014_FIXTURE_IDS,
  displayId: "ffffffff-ffff-4fff-8fff-ffffffffff01",
  displaySessionId: "ffffffff-ffff-4fff-8fff-ffffffffff02",
  humanReportId: "ffffffff-ffff-4fff-8fff-ffffffffff03",
  humanMutationId: "ffffffff-ffff-4fff-8fff-ffffffffff04",
} as const;

const THROUGH_015 = ["015_household_displays.sql"] as const;

/** Apply forward migration 015 only (leaves 016+ for upgrade proofs). */
export function applyMigration015(db: Database.Database): void {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: string }).id),
  );
  db.pragma("foreign_keys = OFF");
  try {
    for (const file of THROUGH_015) {
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

function insertDisplayExecutionExtras(db: Database.Database): void {
  const ids = P015_FIXTURE_IDS;
  const now = "2026-09-20T17:00:00.000Z";

  db.prepare(
    `INSERT INTO household_displays
       (id, household_id, label, created_by_membership_id, created_at, config_version, revoked_at)
     VALUES (?, ?, 'Kitchen wall', ?, ?, 1, NULL)`,
  ).run(ids.displayId, ids.householdId, ids.morganId, now);

  db.prepare(
    `INSERT INTO display_sessions
       (id, display_id, token_digest, created_at, last_seen_at, absolute_expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    ids.displaySessionId,
    ids.displayId,
    randomUUID().replace(/-/g, ""),
    now,
    now,
    "2027-09-20T17:00:00.000Z",
  );

  // Prefer an existing Cats occurrence step if present; otherwise skip report insert.
  const occ = db
    .prepare(
      `SELECT o.id AS occurrence_id, os.id AS step_id, o.accountable_member_id
       FROM occurrences o
       JOIN occurrence_steps os ON os.occurrence_id = o.id
       WHERE o.household_id = ?
       ORDER BY o.household_date DESC, os.position
       LIMIT 1`,
    )
    .get(ids.householdId) as
    | {
        occurrence_id: string;
        step_id: string;
        accountable_member_id: string | null;
      }
    | undefined;

  if (occ?.accountable_member_id) {
    db.prepare(
      `INSERT INTO step_reports
         (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id,
          acting_member_id, performer_member_id, performed_at, recorded_at, resulting_state)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'completed')`,
    ).run(
      ids.humanReportId,
      ids.humanMutationId,
      occ.occurrence_id,
      occ.step_id,
      occ.accountable_member_id,
      occ.accountable_member_id,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO mutation_receipts
         (mutation_id, response_json, created_at, household_id, occurrence_id,
          occurrence_step_id, actor_membership_id, kind, resulting_state,
          activity_generation, payload_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'routine', 'completed', 0, 'fixture-digest')`,
    ).run(
      ids.humanMutationId,
      JSON.stringify({
        report: {
          id: ids.humanReportId,
          actingMemberId: occ.accountable_member_id,
          occurrenceStepId: occ.step_id,
          resultingState: "completed",
        },
        occurrence: { id: occ.occurrence_id, kind: "routine" },
      }),
      now,
      ids.householdId,
      occ.occurrence_id,
      occ.step_id,
      occ.accountable_member_id,
    );
  }
}

/** Open disposable DB with schema through 015 and populated representative rows. */
export function openPopulatedP015UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP014UpgradeDatabase(dbPath, timezone);
  db.pragma("foreign_keys = OFF");
  try {
    applyMigration015(db);
    insertDisplayExecutionExtras(db);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}
