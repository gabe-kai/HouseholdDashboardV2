import type Database from "better-sqlite3";
import { householdDateFromInstant } from "../domain/time.js";

/**
 * P0-004B: baseline dated membership versions using household-local calendar dates.
 * Idempotent — safe after fresh 004 SQL and as a repair for UTC-substr baselines.
 *
 * Only version-1 rows created here receive current live members. Existing version-1
 * member sets are left untouched so later membership edits stay prospective.
 */
export function backfillGroupMembershipBaselines(db: Database.Database): void {
  const groups = db
    .prepare(
      `SELECT g.id, g.created_at, h.timezone
       FROM household_groups g
       JOIN households h ON h.id = g.household_id`,
    )
    .all() as Array<{ id: string; created_at: string; timezone: string }>;

  const hasVersion1 = db.prepare(
    `SELECT id, effective_date FROM group_membership_versions
     WHERE group_id = ? AND version = 1`,
  );
  const updateDate = db.prepare(
    `UPDATE group_membership_versions SET effective_date = ? WHERE id = ?`,
  );
  const insertVersionRow = db.prepare(
    `INSERT INTO group_membership_versions
       (id, group_id, version, effective_date, created_at)
     VALUES (?, ?, 1, ?, ?)`,
  );
  const insertMember = db.prepare(
    `INSERT INTO group_membership_version_members (version_id, membership_id)
     VALUES (?, ?)`,
  );
  const liveMembers = db.prepare(
    `SELECT membership_id FROM household_group_members WHERE group_id = ?`,
  );

  const tx = db.transaction(() => {
    for (const group of groups) {
      const localDate = householdDateFromInstant(group.created_at, group.timezone);
      const existing = hasVersion1.get(group.id) as
        | { id: string; effective_date: string }
        | undefined;
      if (!existing) {
        const versionId = `${group.id}:v1`;
        insertVersionRow.run(versionId, group.id, localDate, group.created_at);
        const members = liveMembers.all(group.id) as Array<{ membership_id: string }>;
        for (const member of members) {
          insertMember.run(versionId, member.membership_id);
        }
        continue;
      }
      if (existing.effective_date !== localDate) {
        updateDate.run(localDate, existing.id);
      }
    }
  });
  tx();
}
