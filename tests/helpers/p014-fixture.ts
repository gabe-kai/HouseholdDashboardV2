/**
 * Populated through-014 baseline for P0-007C-2 upgrade tests.
 * Applies schema through 014; callers run migrate() for 015+.
 *
 * Builds on the through-013 Cats/Trash fixture, then applies 014 and adds
 * private/shared personal tasks plus a durable member session for AT1 proofs.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  openPopulatedP013UpgradeDatabase,
  P013_FIXTURE_IDS,
} from "./p013-fixture.js";

export const P014_FIXTURE_IDS = {
  ...P013_FIXTURE_IDS,
  privateTaskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
  householdTaskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
  memberSessionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03",
  memberUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04",
} as const;

const THROUGH_014 = ["014_assignment_patterns_scheduled_work.sql"] as const;

/** Apply forward migration 014 only (leaves 015+ for upgrade proofs). */
export function applyMigration014(db: Database.Database): void {
  const migrationsDir = path.resolve(process.cwd(), "db/migrations");
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: string }).id),
  );
  db.pragma("foreign_keys = OFF");
  try {
    for (const file of THROUGH_014) {
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

function insertDisplayUpgradeExtras(db: Database.Database): void {
  const ids = P014_FIXTURE_IDS;
  const now = "2026-09-10T17:00:00.000Z";

  db.prepare(
    `INSERT INTO personal_tasks
       (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
     VALUES (?, ?, ?, 'PRIVATE_TASK_SECRET_TITLE', 'private', 'open', ?, ?),
            (?, ?, ?, 'Shared grocery list', 'household', 'open', ?, ?)`,
  ).run(
    ids.privateTaskId,
    ids.householdId,
    ids.averyId,
    now,
    now,
    ids.householdTaskId,
    ids.householdId,
    ids.averyId,
    now,
    now,
  );

  // Ensure Morgan has a user + session so upgrade preserves member auth rows.
  db.prepare(
    `INSERT OR IGNORE INTO users (id, login_name, created_at)
     VALUES (?, 'fixture.morgan.p014', ?)`,
  ).run(ids.memberUserId, now);
  db.prepare(
    `INSERT OR IGNORE INTO user_credentials (user_id, passphrase_phc, updated_at)
     VALUES (?, 'argon2id$fixture', ?)`,
  ).run(ids.memberUserId, now);
  db.prepare(
    `UPDATE household_memberships SET user_id = ?, status = 'active' WHERE id = ?`,
  ).run(ids.memberUserId, ids.morganId);
  db.prepare(
    `INSERT OR IGNORE INTO auth_sessions
       (id, user_id, membership_id, token_digest, csrf_secret, created_at,
        last_seen_at, absolute_expires_at)
     VALUES (?, ?, ?, ?, 'fixture-csrf', ?, ?, ?)`,
  ).run(
    ids.memberSessionId,
    ids.memberUserId,
    ids.morganId,
    randomUUID().replace(/-/g, ""),
    now,
    now,
    "2027-09-10T17:00:00.000Z",
  );
}

/** Open disposable DB with schema through 014 and populated representative rows. */
export function openPopulatedP014UpgradeDatabase(
  dbPath: string,
  timezone = "America/New_York",
): Database.Database {
  const db = openPopulatedP013UpgradeDatabase(dbPath, timezone);
  db.pragma("foreign_keys = OFF");
  try {
    applyMigration014(db);
    insertDisplayUpgradeExtras(db);
  } finally {
    db.pragma("foreign_keys = ON");
  }
  return db;
}
