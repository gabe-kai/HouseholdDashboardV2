import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays } from "../../src/domain/time.js";
import { selectMembershipVersionForDate } from "../../src/domain/participation.js";
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
    migrate(db);

    const version = db
      .prepare("SELECT version, effective_date FROM group_membership_versions WHERE group_id = ?")
      .get(groupId) as { version: number; effective_date: string };
    expect(version.version).toBe(1);
    expect(version.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("baselines existing groups with household-local dates near UTC midnight", async () => {
    const dbPath = path.join(os.tmpdir(), `hd-004b-tz-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    migrate(db);

    const householdId = randomUUID();
    const groupId = randomUUID();
    const memberId = randomUUID();
    // 2026-09-13 02:30 UTC is still 2026-09-12 evening in America/New_York.
    const createdAt = "2026-09-13T02:30:00.000Z";
    db.prepare(
      `INSERT INTO households (id, name, timezone) VALUES (?, 'TZ House', 'America/New_York')`,
    ).run(householdId);
    db.prepare(
      `INSERT INTO household_memberships
         (id, household_id, display_name, status, classification, version, created_at)
       VALUES (?, ?, 'Local Child', 'pending', 'child', 1, ?)`,
    ).run(memberId, householdId, createdAt);
    db.prepare(
      `INSERT INTO household_groups (id, household_id, name, version, created_at, updated_at)
       VALUES (?, ?, 'Evening Crew', 1, ?, ?)`,
    ).run(groupId, householdId, createdAt, createdAt);
    db.prepare(
      `INSERT INTO household_group_members (group_id, membership_id) VALUES (?, ?)`,
    ).run(groupId, memberId);

    // Simulate the pre-fix UTC-substr baseline: on the household-local creation day
    // no version would apply until migrate repairs the date.
    db.prepare(
      `INSERT INTO group_membership_versions (id, group_id, version, effective_date, created_at)
       VALUES (?, ?, 1, '2026-09-13', ?)`,
    ).run(`${groupId}:v1`, groupId, createdAt);
    db.prepare(
      `INSERT INTO group_membership_version_members (version_id, membership_id) VALUES (?, ?)`,
    ).run(`${groupId}:v1`, memberId);
    expect(
      selectMembershipVersionForDate(
        [{ id: `${groupId}:v1`, version: 1, effectiveDate: "2026-09-13" }],
        "2026-09-12",
      ),
    ).toBeNull();

    migrate(db);

    const versionRows = db
      .prepare(
        `SELECT id, version, effective_date FROM group_membership_versions WHERE group_id = ?`,
      )
      .all(groupId) as Array<{ id: string; version: number; effective_date: string }>;
    expect(versionRows).toHaveLength(1);
    expect(versionRows[0]!.effective_date).toBe("2026-09-12");
    expect(versionRows[0]!.effective_date).not.toBe(createdAt.slice(0, 10));

    const selected = selectMembershipVersionForDate(
      versionRows.map((row) => ({
        id: row.id,
        version: row.version,
        effectiveDate: row.effective_date,
      })),
      "2026-09-12",
    );
    expect(selected?.effectiveDate).toBe("2026-09-12");
    const members = db
      .prepare(
        `SELECT membership_id FROM group_membership_version_members WHERE version_id = ?`,
      )
      .all(selected!.id) as Array<{ membership_id: string }>;
    expect(members.map((row) => row.membership_id)).toEqual([memberId]);
  });

  it("keeps today effective members distinct from tomorrow's configured set", async () => {
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
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const before = store.listRoutines(manager.context.householdId)[0]!;
    const todayResolved = before.revisions[0]!.resolvedMemberIds!.sort();
    expect(todayResolved).toEqual([IDS.avery, IDS.jordan].sort());
    expect(before.revisions[0]!.upcomingParticipationFromDate ?? null).toBeNull();

    store.updateGroup(manager.context, boys.id, {
      name: "The Boys",
      membershipIds: [IDS.jordan, IDS.casey],
      expectedVersion: boys.version,
    });
    const group = store.getGroup(manager.context.householdId, boys.id);
    expect(group.membershipIds.sort()).toEqual([IDS.casey, IDS.jordan].sort());
    expect(group.effectiveMembershipIds.sort()).toEqual([IDS.avery, IDS.jordan].sort());
    expect(group.membershipPendingFromDate).toBe(
      addHouseholdDays(store.householdDateNow(manager.context), 1),
    );

    const after = store.listRoutines(manager.context.householdId)[0]!;
    expect(after.revisions[0]!.resolvedMemberIds!.sort()).toEqual(todayResolved);
    expect(after.revisions[0]!.upcomingParticipationFromDate).toBe(
      addHouseholdDays(store.householdDateNow(manager.context), 1),
    );
    expect(after.revisions[0]!.upcomingResolvedMemberIds!.sort()).toEqual(
      [IDS.casey, IDS.jordan].sort(),
    );
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
      daypart: "morning",
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
      daypart: "morning",
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
        daypart: "morning",
        assigneeMemberIds: [IDS.casey],
        assigneeGroupIds: [boys.id],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps,
      }),
    ).toThrow(/Routine couldn't be updated/);

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
      daypart: "morning",
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
      daypart: "morning",
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
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    expect(() => store.deleteGroup(manager.context, boys.id)).toThrow(
      /Remove this group from routines/,
    );

    const today = store.householdDateNow(manager.context);
    const tomorrow = addHouseholdDays(today, 1);
    store.createRevision(manager.context, store.listRoutines(manager.context.householdId)[0]!.id, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
      effectiveDate: tomorrow,
    });

    // Still referenced by today's operative revision
    expect(() => store.deleteGroup(manager.context, boys.id)).toThrow(
      /Remove this group from routines/,
    );

    // Fast-forward: make the revision without the group operative by setting its effective date to today
    // (simulate by creating revision effective tomorrow then... actually today still uses first revision.
    // Delete only after today would use the second revision — need second revision effective <= today.
    // createRevision can target tomorrow; use DB to backdate for this historical test.)
    const routine = store.listRoutines(manager.context.householdId)[0]!;
    const first = routine.revisions[0]!;
    const second = routine.revisions[1]!;
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
      daypart: "morning",
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
    const after = store.listRoutines(manager.context.householdId)[0]!;
    expect(after.revisions[0]!.assigneeMemberIds).toEqual([IDS.jordan]);

    const tomorrow = addHouseholdDays(store.householdDateNow(manager.context), 1);
    const next = store.createRevision(manager.context, after.id, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      assigneeMemberIds: [IDS.jordan],
      assigneeGroupIds: [boys.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
      // Normalize against tomorrow's group membership (Jordan already pending in Kids).
      effectiveDate: tomorrow,
    });
    const latest = next.routine.revisions.at(-1)!;
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
      daypart: "morning",
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
      daypart: "morning",
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
