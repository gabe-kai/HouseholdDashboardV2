import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { SEED } from "../../src/server/seeds/evaluation.js";
import {
  P001_FIXTURE_IDS,
  applyPopulatedP001Fixture,
} from "../helpers/p001-fixture.js";

const temps: string[] = [];

afterEach(() => {
  for (const p of temps.splice(0)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("P0-003 migration semantics", () => {
  it("preserves populated pre-P0-002 facts and reapplies current migrations idempotently", () => {
    const dbPath = path.join(os.tmpdir(), `hd-mig-sem-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    applyPopulatedP001Fixture(db);

    const before = {
      steps: db
        .prepare(
          "SELECT position, text, obligation, status FROM occurrence_steps WHERE occurrence_id = ? ORDER BY position",
        )
        .all(P001_FIXTURE_IDS.occurrenceId),
      report: db
        .prepare(
          `SELECT accountable_member_id, acting_member_id, performed_at, recorded_at,
                  resulting_state, mutation_id
           FROM step_reports WHERE occurrence_id = ?`,
        )
        .get(P001_FIXTURE_IDS.occurrenceId),
      assignee: db
        .prepare("SELECT member_id FROM revision_assignees WHERE revision_id = ?")
        .get(P001_FIXTURE_IDS.revisionId),
      household: db
        .prepare("SELECT id, timezone FROM households WHERE id = ?")
        .get(SEED.household.id),
    };

    migrate(db);
    migrate(db);

    const after = {
      steps: db
        .prepare(
          "SELECT position, text, obligation, status FROM occurrence_steps WHERE occurrence_id = ? ORDER BY position",
        )
        .all(P001_FIXTURE_IDS.occurrenceId),
      report: db
        .prepare(
          `SELECT accountable_member_id, acting_member_id, performed_at, recorded_at,
                  resulting_state, mutation_id
           FROM step_reports WHERE occurrence_id = ?`,
        )
        .get(P001_FIXTURE_IDS.occurrenceId),
      assignee: db
        .prepare("SELECT member_id FROM revision_assignees WHERE revision_id = ?")
        .get(P001_FIXTURE_IDS.revisionId),
      household: db
        .prepare("SELECT id, timezone FROM households WHERE id = ?")
        .get(SEED.household.id),
    };
    expect(after).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) as c FROM sessions").get()).toEqual({ c: 0 });
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM schema_migrations")
          .get() as { c: number }
      ).c,
    ).toBe(2);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM household_memberships")
          .get() as { c: number }
      ).c,
    ).toBe(SEED.members.length);
    expect(
      (
        db
          .prepare("SELECT status FROM household_memberships WHERE id = ?")
          .get(SEED.members[1].id) as { status: string }
      ).status,
    ).toBe("pending");
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM revision_steps WHERE logical_item_id IS NULL")
          .get() as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM step_reports WHERE mutation_id = ?")
          .get(P001_FIXTURE_IDS.mutationId) as { c: number }
      ).c,
    ).toBe(1);
    // Pre-auth fixture has no users/layers/proposals; grants may be backfilled from legacy capabilities.
    expect(db.prepare("SELECT COUNT(*) as c FROM users").get()).toEqual({ c: 0 });
    expect(
      (
        db.prepare("SELECT COUNT(*) as c FROM membership_grants").get() as { c: number }
      ).c,
    ).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) as c FROM personal_routine_revisions").get()).toEqual({
      c: 0,
    });
    expect(db.prepare("SELECT COUNT(*) as c FROM routine_proposals").get()).toEqual({ c: 0 });
  });
});
