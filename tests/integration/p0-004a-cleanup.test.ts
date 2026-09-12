import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import {
  evaluateMembership,
  runFixtureCleanup,
} from "../../src/server/scripts/cleanup-fixtures.js";
import { SEED } from "../../src/server/seeds/evaluation.js";
import { AppStore } from "../../src/server/store.js";
import { claimManager, IDS } from "../helpers/auth-fixture.js";

const temps: string[] = [];

afterEach(() => {
  for (const p of temps.splice(0)) {
    try {
      fs.rmSync(p, { force: true, recursive: true });
    } catch {
      /* ignore */
    }
  }
});

function freshSeededDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `hd-004a-clean-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  const backupDir = path.join(os.tmpdir(), `hd-004a-bak-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  temps.push(dbPath, backupDir);
  fs.mkdirSync(backupDir, { recursive: true });
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { db, store, dbPath, backupDir };
}

describe("P0-004A r3 fixture cleanup inventory", () => {
  it("removes only safe exact fixture IDs and ignores renamed display names", async () => {
    const { db, store, dbPath, backupDir } = freshSeededDb();
    await claimManager(store);
    // Renamed fixture still identified by ID, not display name.
    db.prepare("UPDATE household_memberships SET display_name = ? WHERE id = ?").run(
      "Renamed Avery",
      IDS.avery,
    );
    db.prepare("UPDATE members SET display_name = ? WHERE id = ?").run("Renamed Avery", IDS.avery);
    // Same-name non-fixture must never be selected.
    const nonFixtureId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO members (id, household_id, display_name, capabilities_json)
       VALUES (?, ?, ?, ?)`,
    ).run(nonFixtureId, SEED.household.id, "Avery Reed", "[]");
    db.prepare(
      `INSERT INTO household_memberships
       (id, household_id, user_id, display_name, status, created_at)
       VALUES (?, ?, NULL, ?, 'pending', ?)`,
    ).run(nonFixtureId, SEED.household.id, "Avery Reed", now);
    db.close();

    const dry = await runFixtureCleanup({ dbPath, apply: false, backupDir });
    expect(dry.mode).toBe("dry-run");
    expect(dry.candidates).toContain(IDS.avery);
    expect(dry.candidates).not.toContain(nonFixtureId);
    expect(dry.candidates).not.toContain(IDS.morgan);
    expect(dry.blocked.some((b) => b.membershipId === IDS.morgan)).toBe(true);

    const before = openDatabase(dbPath);
    expect(before.prepare("SELECT COUNT(*) AS c FROM household_memberships").get()).toEqual({
      c: 7,
    });
    before.close();

    const applied = await runFixtureCleanup({ dbPath, apply: true, backupDir });
    expect(applied.removed).toContain(IDS.avery);
    expect(applied.removed).not.toContain(IDS.morgan);
    expect(applied.removed).not.toContain(nonFixtureId);
    expect(applied.backupPath && fs.existsSync(applied.backupPath)).toBe(true);

    const after = openDatabase(dbPath);
    const remaining = (
      after.prepare("SELECT id FROM household_memberships ORDER BY id").all() as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    expect(remaining).toEqual([IDS.morgan, nonFixtureId].sort());
    after.close();

    const again = await runFixtureCleanup({ dbPath, apply: true, backupDir });
    expect(again.removed).toEqual([]);
  });

  it("blocks target enrollment claim and creator authorship", () => {
    const { db } = freshSeededDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO enrollment_claims
       (id, household_id, membership_id, token_digest, preset, display_name,
        created_by_membership_id, created_at, expires_at, consumed_at, kind)
       VALUES (?, ?, ?, ?, 'direct_personalizer', NULL, ?, ?, ?, NULL, 'enrollment')`,
    ).run(
      randomUUID(),
      SEED.household.id,
      IDS.avery,
      `digest-target-${randomUUID()}`,
      IDS.jordan,
      now,
      now,
    );

    const target = evaluateMembership(db, IDS.avery, SEED.household.id);
    expect(target.status).toBe("blocked");
    expect(target.blockers).toContain("has_enrollment_claim");

    const creator = evaluateMembership(db, IDS.jordan, SEED.household.id);
    expect(creator.status).toBe("blocked");
    expect(creator.blockers).toContain("has_enrollment_authorship");
    db.close();
  });

  it("blocks legacy sessions.member_id references", () => {
    const { db } = freshSeededDb();
    db.prepare(
      `INSERT INTO sessions (id, household_id, member_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(randomUUID(), SEED.household.id, IDS.casey, new Date().toISOString());
    const report = evaluateMembership(db, IDS.casey, SEED.household.id);
    expect(report.status).toBe("blocked");
    expect(report.blockers).toContain("has_legacy_session");
    db.close();
  });

  it("blocks structure and step mutation receipts that mention the membership id", () => {
    const { db } = freshSeededDb();
    db.prepare(
      `INSERT INTO structure_mutation_receipts
       (mutation_id, kind, response_json, created_at)
       VALUES (?, 'person_create', ?, ?)`,
    ).run(
      randomUUID(),
      JSON.stringify({ person: { id: IDS.taylor, displayName: "Taylor Reed" } }),
      new Date().toISOString(),
    );
    db.prepare(
      `INSERT INTO mutation_receipts (mutation_id, response_json, created_at)
       VALUES (?, ?, ?)`,
    ).run(
      randomUUID(),
      JSON.stringify({ accountableMemberId: IDS.rowan }),
      new Date().toISOString(),
    );

    expect(evaluateMembership(db, IDS.taylor, SEED.household.id).blockers).toContain(
      "has_structure_receipt",
    );
    expect(evaluateMembership(db, IDS.rowan, SEED.household.id).blockers).toContain(
      "has_mutation_receipt",
    );
    db.close();
  });

  it("blocks group membership, personal task, and occurrence history references", () => {
    const { db, store } = freshSeededDb();
    const now = new Date().toISOString();
    const groupId = randomUUID();
    db.prepare(
      `INSERT INTO household_groups (id, household_id, name, version, created_at, updated_at)
       VALUES (?, ?, 'Kids', 1, ?, ?)`,
    ).run(groupId, SEED.household.id, now, now);
    db.prepare(
      `INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)`,
    ).run(groupId, IDS.avery);
    db.prepare(
      `INSERT INTO personal_tasks
       (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
       VALUES (?, ?, ?, 'Note', 'private', 'open', ?, ?)`,
    ).run(randomUUID(), SEED.household.id, IDS.jordan, now, now);

    // Minimal occurrence history for casey.
    const defId = randomUUID();
    const revId = randomUUID();
    const occId = randomUUID();
    db.prepare(
      `INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')`,
    ).run(defId, SEED.household.id);
    db.prepare(
      `INSERT INTO routine_revisions
       (id, definition_id, effective_date, title, weekdays_json, created_at)
       VALUES (?, ?, '2026-01-01', 'Morning', '[1]', ?)`,
    ).run(revId, defId, now);
    db.prepare(
      `INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)`,
    ).run(revId, IDS.casey);
    db.prepare(
      `INSERT INTO occurrences
       (id, household_id, definition_id, revision_id, household_date, accountable_member_id,
        title, schedule_anchor, version)
       VALUES (?, ?, ?, ?, '2026-01-01', ?, 'Morning', 'morning', 1)`,
    ).run(occId, SEED.household.id, defId, revId, IDS.casey);

    expect(evaluateMembership(db, IDS.avery, SEED.household.id).blockers).toContain(
      "has_group_membership",
    );
    expect(evaluateMembership(db, IDS.jordan, SEED.household.id).blockers).toContain(
      "has_personal_task",
    );
    const casey = evaluateMembership(db, IDS.casey, SEED.household.id);
    expect(casey.blockers).toEqual(
      expect.arrayContaining(["has_revision_assignment", "has_occurrence"]),
    );
    void store;
    db.close();
  });

  it("aborts apply when backup fails and leaves memberships unchanged", async () => {
    const { db, dbPath, backupDir } = freshSeededDb();
    const before = (
      db.prepare("SELECT id FROM household_memberships ORDER BY id").all() as Array<{ id: string }>
    ).map((r) => r.id);
    db.close();

    await expect(
      runFixtureCleanup({
        dbPath,
        apply: true,
        backupDir,
        backup: async () => {
          throw new Error("simulated backup failure");
        },
      }),
    ).rejects.toThrow(/Backup failed; no memberships removed/);

    const afterDb = openDatabase(dbPath);
    const after = (
      afterDb.prepare("SELECT id FROM household_memberships ORDER BY id").all() as Array<{
        id: string;
      }>
    ).map((r) => r.id);
    expect(after).toEqual(before);
    afterDb.close();
  });

  it("rechecks predicates after dry-run so newly introduced references block apply", async () => {
    const { db, dbPath, backupDir } = freshSeededDb();
    db.close();

    const dry = await runFixtureCleanup({ dbPath, apply: false, backupDir });
    expect(dry.candidates).toContain(IDS.avery);

    const reopen = openDatabase(dbPath);
    reopen
      .prepare(
        `INSERT INTO personal_tasks
         (id, household_id, owner_membership_id, title, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Late ref', 'private', 'open', ?, ?)`,
      )
      .run(
        randomUUID(),
        SEED.household.id,
        IDS.avery,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    reopen.close();

    const applied = await runFixtureCleanup({ dbPath, apply: true, backupDir });
    expect(applied.removed).not.toContain(IDS.avery);
    const checkDb = openDatabase(dbPath);
    try {
      expect(evaluateMembership(checkDb, IDS.avery, SEED.household.id).blockers).toContain(
        "has_personal_task",
      );
    } finally {
      checkDb.close();
    }
  });

  it("never inventories non-manifest ids even when display names collide", async () => {
    const { db, dbPath, backupDir } = freshSeededDb();
    const twinId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO members (id, household_id, display_name, capabilities_json)
       VALUES (?, ?, 'Morgan Reed', ?)`,
    ).run(twinId, SEED.household.id, "[]");
    db.prepare(
      `INSERT INTO household_memberships
       (id, household_id, user_id, display_name, status, created_at)
       VALUES (?, ?, NULL, 'Morgan Reed', 'pending', ?)`,
    ).run(twinId, SEED.household.id, now);
    db.close();

    const dry = await runFixtureCleanup({ dbPath, apply: false, backupDir });
    expect(dry.candidates).not.toContain(twinId);
    expect(dry.blocked.every((b) => b.membershipId !== twinId)).toBe(true);
  });
});
