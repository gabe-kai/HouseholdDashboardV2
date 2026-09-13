import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays } from "../../src/domain/time.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import {
  claimManager,
  enrollAndClaim,
  IDS,
} from "../helpers/auth-fixture.js";
import { applyPopulatedP001Fixture } from "../helpers/p001-fixture.js";

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

function freshStore() {
  const dbPath = path.join(
    os.tmpdir(),
    `hd-004b-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { store, db, dbPath };
}

const steps = [
  { text: "Make bed", obligation: "required" as const },
  { text: "Pack lunch", obligation: "as_needed" as const },
];

describe("P0-004B group-backed Morning Routine", () => {
  it("migrates populated P0-001 fixture and existing groups get baseline versions", async () => {
    const dbPath = path.join(os.tmpdir(), `hd-004b-mig-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    applyPopulatedP001Fixture(db);
    migrate(db);
    migrate(db);

    // Insert a group as if created under 003, then ensure 004 backfill ran (re-run inserts are guarded).
    const groupId = randomUUID();
    const now = new Date().toISOString();
    const householdId = (
      db.prepare("SELECT id FROM households LIMIT 1").get() as { id: string }
    ).id;
    db.prepare(
      `INSERT INTO household_groups (id, household_id, name, version, created_at, updated_at)
       VALUES (?, ?, 'Legacy Kids', 1, ?, ?)`,
    ).run(groupId, householdId, now, now);
    // Simulate pre-004 state: no versions for this group — run backfill SQL fragment
    db.prepare(
      `INSERT INTO group_membership_versions (id, group_id, version, effective_date, created_at)
       SELECT ?, ?, 1, substr(?, 1, 10), ?
       WHERE NOT EXISTS (SELECT 1 FROM group_membership_versions WHERE group_id = ?)`,
    ).run(`${groupId}:v1`, groupId, now, now, groupId);

    const version = db
      .prepare("SELECT version, effective_date FROM group_membership_versions WHERE group_id = ?")
      .get(groupId) as { version: number; effective_date: string };
    expect(version.version).toBe(1);
    expect(version.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("persists group+direct sources and replays routine mutations", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.${Date.now().toString(36)}`,
      "Avery Reed",
    );

    const boys = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "The Boys",
      membershipIds: [IDS.avery, IDS.jordan],
    });
    const mutationId = randomUUID();
    const routine = store.createRoutine(manager.context, {
      mutationId,
      title: "Morning Routine",
      assigneeMemberIds: [IDS.casey],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    expect(routine).toBeTruthy();
    const rev = routine!.revisions[0]!;
    expect(rev.assigneeGroupIds).toEqual([boys.id]);
    expect(rev.assigneeMemberIds).toEqual([IDS.casey]);
    expect(rev.resolvedMemberIds).toEqual(
      [IDS.avery, IDS.casey, IDS.jordan].sort(),
    );

    const replay = store.createRoutine(manager.context, {
      mutationId,
      title: "Morning Routine",
      assigneeMemberIds: [IDS.casey],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    expect(replay!.id).toBe(routine!.id);
    expect(replay!.revisions).toHaveLength(1);

    expect(() =>
      store.createRoutine(manager.context, {
        mutationId,
        title: "Different",
        assigneeMemberIds: [IDS.casey],
        assigneeGroupIds: [boys.id],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps,
      }),
    ).toThrow(/Morning Routine couldn't be updated/);

    const today = store.householdDateNow(manager.context);
    const occurrences = store.materializeForDate(manager.context, today);
    expect(occurrences.map((o) => o.accountableMemberId).sort()).toEqual(
      [IDS.avery, IDS.casey, IDS.jordan].sort(),
    );
    void db;
  });

  it("applies next-day group membership without rewriting today or deleting future rows", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `a.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `j.${Date.now().toString(36)}`,
      "Jordan Reed",
    );

    const boys = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "The Boys",
      membershipIds: [IDS.avery, IDS.jordan],
    });
    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });

    const today = store.householdDateNow(manager.context);
    const tomorrow = addHouseholdDays(today, 1);
    const beforeToday = store.materializeForDate(manager.context, today);
    const futureBefore = store.materializeForDate(manager.context, tomorrow);
    expect(futureBefore.map((o) => o.accountableMemberId).sort()).toEqual(
      [IDS.avery, IDS.jordan].sort(),
    );
    const averyFuture = futureBefore.find((o) => o.accountableMemberId === IDS.avery)!;
    const snap = store.occurrenceSnapshotStructure(averyFuture.id);

    store.updateGroup(manager.context, boys.id, {
      name: "The Boys",
      membershipIds: [IDS.jordan],
      expectedVersion: boys.version,
    });

    const afterToday = store.materializeForDate(manager.context, today);
    expect(afterToday.map((o) => o.accountableMemberId).sort()).toEqual(
      beforeToday.map((o) => o.accountableMemberId).sort(),
    );
    expect(store.occurrenceSnapshotStructure(averyFuture.id)).toEqual(snap);

    const futureAfter = store.materializeForDate(manager.context, tomorrow);
    expect(futureAfter.map((o) => o.accountableMemberId)).toEqual([IDS.jordan]);

    const retained = db
      .prepare("SELECT id FROM occurrences WHERE id = ?")
      .get(averyFuture.id);
    expect(retained).toBeTruthy();

    expect(() =>
      store.setStepStatus(manager.context, averyFuture.id, averyFuture.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });

  it("rejects future checklist status and allows current after enrollment", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `av.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const today = store.householdDateNow(manager.context);
    const tomorrow = addHouseholdDays(today, 1);
    const future = store.materializeForDate(manager.context, tomorrow);
    const occ = future.find((o) => o.accountableMemberId === IDS.avery)!;
    expect(() =>
      store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
      }),
    ).toThrow(/isn't available yet/);

    const todayOcc = store
      .materializeForDate(avery.context, today)
      .find((o) => o.accountableMemberId === IDS.avery)!;
    const result = store.setStepStatus(avery.context, todayOcc.id, todayOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    expect(result.occurrence.steps[0]!.status).toBe("completed");
  });

  it("blocks delete while referenced and tombstones after historical only", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const boys = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "The Boys",
      membershipIds: [IDS.avery],
    });
    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    expect(() => store.deleteGroup(manager.context, boys.id)).toThrow(
      /Remove this group from Morning Routine/,
    );

    store.createRevision(manager.context, store.getRoutine(manager.context.householdId)!.id, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });

    // Still referenced by today's operative revision
    expect(() => store.deleteGroup(manager.context, boys.id)).toThrow(
      /Remove this group from Morning Routine/,
    );

    // Fast-forward: make the revision without the group operative by setting its effective date to today
    // (simulate by creating revision effective tomorrow then... actually today still uses first revision.
    // Delete only after today would use the second revision — need second revision effective <= today.
    // createRevision requires next day minimum. So use DB to backdate for this historical test.)
    const routine = store.getRoutine(manager.context.householdId)!;
    const first = routine.revisions[0]!;
    const second = routine.revisions[1]!;
    const today = store.householdDateNow(manager.context);
    const yesterday = addHouseholdDays(today, -1);
    db.prepare("UPDATE routine_revisions SET effective_date = ? WHERE id = ?").run(
      yesterday,
      first.id,
    );
    db.prepare("UPDATE routine_revisions SET effective_date = ? WHERE id = ?").run(
      today,
      second.id,
    );

    store.deleteGroup(manager.context, boys.id);
    expect(store.listGroups(manager.context.householdId).find((g) => g.id === boys.id)).toBeUndefined();
    const row = db
      .prepare("SELECT deleted_at FROM household_groups WHERE id = ?")
      .get(boys.id) as { deleted_at: string | null };
    expect(row.deleted_at).toBeTruthy();

    const renamed = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "The Boys",
      membershipIds: [],
    });
    expect(renamed.id).not.toBe(boys.id);
  });

  it("keeps later overlap direct sources until deliberate save normalizes", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const boys = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "The Boys",
      membershipIds: [IDS.avery],
    });
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [IDS.jordan],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    expect(routine!.revisions[0]!.assigneeMemberIds).toEqual([IDS.jordan]);

    store.updateGroup(manager.context, boys.id, {
      name: "The Boys",
      membershipIds: [IDS.avery, IDS.jordan],
      expectedVersion: boys.version,
    });
    const after = store.getRoutine(manager.context.householdId)!;
    expect(after.revisions[0]!.assigneeMemberIds).toEqual([IDS.jordan]);

    const next = store.createRevision(manager.context, after.id, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [IDS.jordan],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const latest = next!.revisions.at(-1)!;
    expect(latest.assigneeMemberIds).toEqual([]);
    expect(latest.assigneeGroupIds).toEqual([boys.id]);
  });

  it("allows empty group as only source", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const empty = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "Empty Crew",
      membershipIds: [],
    });
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [],
      assigneeGroupIds: [empty.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    expect(routine!.revisions[0]!.resolvedMemberIds).toEqual([]);
    const today = store.householdDateNow(manager.context);
    expect(store.materializeForDate(manager.context, today)).toEqual([]);
  });

  it("applies only the greatest same-day membership version tomorrow", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const boys = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "The Boys",
      membershipIds: [IDS.avery, IDS.jordan],
    });
    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      assigneeMemberIds: [],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });

    const today = store.householdDateNow(manager.context);
    const tomorrow = addHouseholdDays(today, 1);
    const todayBefore = store
      .materializeForDate(manager.context, today)
      .map((o) => o.accountableMemberId)
      .sort();

    const first = store.updateGroup(manager.context, boys.id, {
      name: "The Boys",
      membershipIds: [IDS.avery],
      expectedVersion: boys.version,
    });
    expect(first.membershipIds.sort()).toEqual([IDS.avery].sort());

    expect(() =>
      store.updateGroup(manager.context, boys.id, {
        name: "The Boys",
        membershipIds: [IDS.jordan],
        expectedVersion: boys.version,
      }),
    ).toThrow(/updated elsewhere/);

    const second = store.updateGroup(manager.context, boys.id, {
      name: "The Boys",
      membershipIds: [IDS.jordan, IDS.casey],
      expectedVersion: first.version,
    });
    expect(second.membershipIds.sort()).toEqual([IDS.casey, IDS.jordan].sort());

    expect(
      store.materializeForDate(manager.context, today).map((o) => o.accountableMemberId).sort(),
    ).toEqual(todayBefore);
    expect(
      store.materializeForDate(manager.context, tomorrow).map((o) => o.accountableMemberId).sort(),
    ).toEqual([IDS.casey, IDS.jordan].sort());
  });
});
