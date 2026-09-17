import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays } from "../../src/domain/time.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import { claimManager, enrollAndClaim, IDS } from "../helpers/auth-fixture.js";
import { openPopulatedP004BUpgradeDatabase, P004B_FIXTURE_IDS } from "../helpers/p004b-fixture.js";
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
    `hd-005-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
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

describe("P0-005 multiple household routines", () => {
  it("upgrades populated P0-004B fixture preserving Morning IDs and daypart", () => {
    const dbPath = path.join(os.tmpdir(), `hd-005-fix-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP004BUpgradeDatabase(dbPath);
    migrate(db);

    const def = db
      .prepare("SELECT id, archive_cutoff_date FROM routine_definitions WHERE id = ?")
      .get(P004B_FIXTURE_IDS.definitionId) as { id: string; archive_cutoff_date: string | null };
    expect(def.id).toBe(P004B_FIXTURE_IDS.definitionId);
    expect(def.archive_cutoff_date).toBeNull();

    const rev = db
      .prepare("SELECT daypart, title FROM routine_revisions WHERE id = ?")
      .get(P004B_FIXTURE_IDS.revisionId) as { daypart: string; title: string };
    expect(rev.daypart).toBe("morning");
    expect(rev.title).toBe("Morning Routine");

    const occ = db
      .prepare("SELECT daypart FROM occurrences WHERE id = ?")
      .get(P004B_FIXTURE_IDS.occurrenceId) as { daypart: string };
    expect(occ.daypart).toBe("morning");

    const proposal = db
      .prepare(
        "SELECT definition_id, association_status FROM routine_proposals WHERE id = ?",
      )
      .get(P004B_FIXTURE_IDS.proposalPendingId) as {
      definition_id: string;
      association_status: string;
    };
    expect(proposal.definition_id).toBe(P004B_FIXTURE_IDS.definitionId);
    expect(proposal.association_status).toBe("resolved");

    const migrations = (
      db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }
    ).c;
    expect(migrations).toBe(9);
  });

  it("retains P0-001 upgrade coverage through migration 005", () => {
    const dbPath = path.join(os.tmpdir(), `hd-005-p001-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    applyPopulatedP001Fixture(db);
    migrate(db);
    migrate(db);
    const daypart = db
      .prepare("SELECT daypart FROM routine_revisions LIMIT 1")
      .get() as { daypart: string };
    expect(daypart.daypart).toBe("morning");
  });

  it("creates independent routines with separate occurrences and completion", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jordan.${Date.now().toString(36)}`,
      "Jordan Reed",
    );

    const morning = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const afterSchool = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "After School Routine",
      daypart: "after_school",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5],
      steps: [
        { text: "Unpack bag", obligation: "required" },
        { text: "Snack", obligation: "optional" },
      ],
    });
    const bedtime = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Bedtime",
      daypart: "bedtime",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Brush teeth", obligation: "required" }],
    });

    expect(store.listRoutines(manager.context.householdId)).toHaveLength(3);

    const today = store.householdDateNow(manager.context);
    // Force a weekday date for After School applicability if today is weekend
    const weekday = today; // seed house uses America/New_York; accept whatever applies
    const occurrences = store.materializeForDate(manager.context, weekday);
    const averyOccs = occurrences.filter((o) => o.accountableMemberId === IDS.avery);
    expect(averyOccs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(averyOccs.map((o) => o.definitionId)).size).toBe(averyOccs.length);

    const morningOcc = averyOccs.find((o) => o.definitionId === morning.id)!;
    const other = averyOccs.find((o) => o.definitionId !== morning.id)!;
    store.setStepStatus(avery.context, morningOcc.id, morningOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    const refreshed = store.materializeForDate(manager.context, weekday);
    const otherAfter = refreshed.find((o) => o.id === other.id)!;
    expect(otherAfter.steps[0]!.status).toBe("open");
    void afterSchool;
    void bedtime;
  });

  it("archives prospectively without rewriting today", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Temp Routine",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const today = store.householdDateNow(manager.context);
    const tomorrow = addHouseholdDays(today, 1);
    const before = store.materializeForDate(manager.context, today);
    expect(before.some((o) => o.definitionId === routine.id)).toBe(true);

    const archived = store.archiveRoutine(manager.context, routine.id, {
      mutationId: randomUUID(),
      expectedVersion: routine.version,
    });
    expect(archived.archived).toBe(true);
    expect(archived.archiveCutoffDate).toBe(tomorrow);
    expect(store.listRoutines(manager.context.householdId).find((r) => r.id === routine.id)).toBeUndefined();
    expect(
      store.listRoutines(manager.context.householdId, { includeArchived: true }).find(
        (r) => r.id === routine.id,
      ),
    ).toBeTruthy();

    const afterToday = store.materializeForDate(manager.context, today);
    expect(afterToday.some((o) => o.definitionId === routine.id)).toBe(true);
    const afterTomorrow = store.materializeForDate(manager.context, tomorrow);
    expect(afterTomorrow.some((o) => o.definitionId === routine.id)).toBe(false);
  });

  it("scopes personal layers per definition", async () => {
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
    const morning = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const bedtime = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Bedtime",
      daypart: "bedtime",
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Brush teeth", obligation: "required" }],
    });

    store.savePersonalLayer(avery.context, {
      definitionId: bedtime.id,
      additions: [{ text: "Read story", obligation: "optional", place: "end" }],
    });
    const bedLayer = store.getPersonalLayer(IDS.avery, bedtime.id, addHouseholdDays(store.householdDateNow(avery.context), 1));
    expect(bedLayer?.additions.map((a) => a.text)).toContain("Read story");
    const morningLayer = store.getPersonalLayer(
      IDS.avery,
      morning.id,
      addHouseholdDays(store.householdDateNow(avery.context), 1),
    );
    expect(morningLayer?.additions.some((a) => a.text === "Read story") ?? false).toBe(false);
  });

  it("keeps independent revisions and dates across definitions", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const morning = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const afterSchool = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "After School Routine",
      daypart: "after_school",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5],
      steps: [{ text: "Unpack", obligation: "required" }],
    });
    const bedtime = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Bedtime",
      daypart: "bedtime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Brush teeth", obligation: "required" }],
    });

    const today = store.householdDateNow(manager.context);
    const revised = store.createRevision(manager.context, afterSchool.id, {
      mutationId: randomUUID(),
      title: "After School Renamed",
      daypart: "evening",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5],
      steps: [
        { text: "Unpack", obligation: "required" },
        { text: "Snack", obligation: "optional" },
      ],
      expectedVersion: afterSchool.version,
      // Same-date refine: omitted effectiveDate defaults to today (not tomorrow drift).
    });
    expect(revised.routine.revisions.at(-1)?.title).toBe("After School Renamed");
    expect(revised.routine.revisions.at(-1)?.daypart).toBe("evening");
    expect(revised.routine.scheduleEntries[0]?.revision.title).toBe("After School Renamed");
    expect(revised.routine.scheduleEntries[0]?.startDate).toBe(today);

    const morningAgain = store.getRoutineById(manager.context.householdId, morning.id)!;
    const bedtimeAgain = store.getRoutineById(manager.context.householdId, bedtime.id)!;
    expect(morningAgain.revisions).toHaveLength(1);
    expect(morningAgain.revisions[0]!.title).toBe("Morning Routine");
    expect(bedtimeAgain.revisions).toHaveLength(1);
    expect(bedtimeAgain.revisions[0]!.title).toBe("Bedtime");

    const later = store.createRevision(manager.context, afterSchool.id, {
      mutationId: randomUUID(),
      title: "After School Later",
      daypart: "after_school",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5],
      steps: [{ text: "Homework", obligation: "required" }],
      expectedVersion: revised.routine.version,
      // Second same-day edit retargets the same current schedule entry.
    });
    expect(later.routine.scheduleEntries).toHaveLength(1);
    expect(later.routine.scheduleEntries[0]!.startDate).toBe(today);
    expect(later.routine.scheduleEntries[0]!.revision.title).toBe("After School Later");
    // Immutable content versions may accumulate; schedule entry identity stays one.
    expect(later.routine.scheduleEntries.filter((e) => e.startDate === today)).toHaveLength(1);
  });

  it("blocks group delete while two routines still reference it", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const group = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "Kids",
      membershipIds: [IDS.morgan],
    });
    const afterSchool = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "After School Routine",
      daypart: "after_school",
      assigneeMemberIds: [],
      assigneeGroupIds: [group.id],
      weekdays: [1, 2, 3, 4, 5],
      steps: [{ text: "Unpack", obligation: "required" }],
    });
    const bedtime = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Bedtime",
      daypart: "bedtime",
      assigneeMemberIds: [],
      assigneeGroupIds: [group.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Brush teeth", obligation: "required" }],
    });

    expect(() => store.deleteGroup(manager.context, group.id)).toThrow(
      /Remove this group from routines/,
    );

    store.archiveRoutine(manager.context, afterSchool.id, {
      mutationId: randomUUID(),
      expectedVersion: afterSchool.version,
    });
    expect(() => store.deleteGroup(manager.context, group.id)).toThrow(
      /Remove this group from routines/,
    );

    store.archiveRoutine(manager.context, bedtime.id, {
      mutationId: randomUUID(),
      expectedVersion: bedtime.version,
    });
    // Still referenced through today's archive cutoff until tomorrow.
    expect(() => store.deleteGroup(manager.context, group.id)).toThrow(
      /Remove this group from routines/,
    );
  });

  it("replays archive with the same mutationId", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Temp",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const mutationId = randomUUID();
    const first = store.archiveRoutine(manager.context, routine.id, {
      mutationId,
      expectedVersion: routine.version,
    });
    const second = store.archiveRoutine(manager.context, routine.id, {
      mutationId,
      expectedVersion: routine.version,
    });
    expect(second.id).toBe(first.id);
    expect(second.archiveCutoffDate).toBe(first.archiveCutoffDate);
  });

  it("flags unresolved legacy proposals without a routine", () => {
    const dbPath = path.join(os.tmpdir(), `hd-005-orphan-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    migrate(db);
    const householdId = randomUUID();
    const membershipId = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, 'Orphan', 'UTC')").run(
      householdId,
    );
    db.prepare(
      `INSERT INTO household_memberships (id, household_id, display_name, status, classification, version, created_at)
       VALUES (?, ?, 'Kid', 'pending', 'child', 1, ?)`,
    ).run(membershipId, householdId, now);
    const proposalId = randomUUID();
    db.prepare(
      `INSERT INTO routine_proposals
         (id, household_id, membership_id, text, obligation, place, status, proposed_at, definition_id, association_status)
       VALUES (?, ?, ?, 'Orphan idea', 'optional', 'end', 'pending', ?, NULL, 'unresolved')`,
    ).run(proposalId, householdId, membershipId, now);
    migrate(db);
    const row = db
      .prepare("SELECT association_status, definition_id FROM routine_proposals WHERE id = ?")
      .get(proposalId) as { association_status: string; definition_id: string | null };
    expect(row.association_status).toBe("unresolved");
    expect(row.definition_id).toBeNull();
  });

  it("rehearses backup → migrate → isolated restore on disposable data", async () => {
    const sourcePath = path.join(os.tmpdir(), `hd-005-bak-src-${Date.now()}.sqlite`);
    const backupPath = path.join(os.tmpdir(), `hd-005-bak-${Date.now()}.sqlite`);
    const restorePath = path.join(os.tmpdir(), `hd-005-bak-dst-${Date.now()}.sqlite`);
    temps.push(sourcePath, backupPath, restorePath);

    const source = openPopulatedP004BUpgradeDatabase(sourcePath);
    const definitionId = P004B_FIXTURE_IDS.definitionId;
    await source.backup(backupPath);
    source.close();

    const migrated = openDatabase(backupPath);
    migrate(migrated);
    migrate(migrated);
    expect(
      migrated.prepare("SELECT daypart FROM routine_revisions WHERE definition_id = ?").get(definitionId),
    ).toEqual({ daypart: "morning" });
    expect(migrated.pragma("foreign_key_check")).toEqual([]);
    expect(migrated.pragma("quick_check", { simple: true })).toBe("ok");
    await migrated.backup(restorePath);
    migrated.close();

    const restored = openDatabase(restorePath);
    expect(
      restored.prepare("SELECT id FROM routine_definitions WHERE id = ?").get(definitionId),
    ).toEqual({ id: definitionId });
    expect(
      restored.prepare("SELECT COUNT(*) as c FROM schema_migrations WHERE id = ?").get(
        "005_multiple_household_routines.sql",
      ),
    ).toEqual({ c: 1 });
    restored.close();
  });

  it("AT19 locks structure on first action and refines same-day unstarted peers", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `av.lock.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const jordan = await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jo.lock.${Date.now().toString(36)}`,
      "Jordan Reed",
    );
    const group = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: "Kids Lock",
      membershipIds: [IDS.avery, IDS.jordan],
    });
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Morning Routine",
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [group.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const today = store.householdDateNow(manager.context);
    const before = store.materializeForDate(manager.context, today);
    const averyOcc = before.find((o) => o.accountableMemberId === IDS.avery)!;
    const jordanOcc = before.find((o) => o.accountableMemberId === IDS.jordan)!;
    expect(averyOcc.startedAt).toBeNull();
    expect(jordanOcc.startedAt).toBeNull();

    // Same-day refine while unstarted updates both.
    store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Morning Checklist",
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [group.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [
        { text: "Make bed carefully", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
      ],
      expectedVersion: routine.version,
      effectiveDate: today,
    });
    const mid = store.materializeForDate(manager.context, today);
    expect(mid.find((o) => o.id === averyOcc.id)!.title).toBe("Morning Checklist");
    expect(mid.find((o) => o.id === jordanOcc.id)!.title).toBe("Morning Checklist");
    expect(mid.find((o) => o.id === averyOcc.id)!.steps[0]!.text).toBe("Make bed carefully");

    // Avery's first locking action freezes Avery only.
    const averyLive = mid.find((o) => o.id === averyOcc.id)!;
    store.setStepStatus(avery.context, averyLive.id, averyLive.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    const afterStart = store.getOccurrenceById(averyLive.id)!;
    expect(afterStart.startedAt).toBeTruthy();

    // Undo does not unlock.
    store.setStepStatus(avery.context, averyLive.id, averyLive.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "open",
      performedAt: new Date().toISOString(),
    });
    expect(store.getOccurrenceById(averyLive.id)!.startedAt).toBe(afterStart.startedAt);

    const routineAfter = store.getRoutineById(manager.context.householdId, routine.id)!;
    store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Morning After Lock",
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [group.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Brand new step", obligation: "required" }],
      expectedVersion: routineAfter.version,
      effectiveDate: today,
    });
    const final = store.materializeForDate(manager.context, today);
    const averyFinal = final.find((o) => o.id === averyOcc.id)!;
    const jordanFinal = final.find((o) => o.id === jordanOcc.id)!;
    expect(averyFinal.title).toBe("Morning Checklist");
    expect(averyFinal.steps[0]!.text).toBe("Make bed carefully");
    expect(jordanFinal.title).toBe("Morning After Lock");
    expect(jordanFinal.steps[0]!.text).toBe("Brand new step");
    expect(jordanFinal.startedAt).toBeNull();

    // Deliberate upcoming schedule while current stays; re-edit thrice keeps one entry.
    const tomorrow = addHouseholdDays(today, 1);
    store.materializeForDate(manager.context, tomorrow);
    const afterFuture = store.getRoutineById(manager.context.householdId, routine.id)!;
    const scheduled = store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Morning Tomorrow",
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [group.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Tomorrow step", obligation: "required" }],
      expectedVersion: afterFuture.version,
      mode: "schedule",
      effectiveDate: tomorrow,
    });
    const tomorrowEntryId = scheduled.routine.scheduleEntries.find(
      (e) => e.startDate === tomorrow,
    )!.id;
    store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Morning Tomorrow Refined",
      daypart: "morning",
      assigneeMemberIds: [],
      assigneeGroupIds: [group.id],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Tomorrow refined", obligation: "required" }],
      expectedVersion: scheduled.routine.version,
      mode: "schedule",
      effectiveDate: tomorrow,
      scheduleEntryId: tomorrowEntryId,
    });
    const tomorrowOccs = store.materializeForDate(manager.context, tomorrow);
    expect(
      tomorrowOccs.every((o) => o.title === "Morning Tomorrow Refined"),
    ).toBe(true);
    expect(
      store
        .getRoutineById(manager.context.householdId, routine.id)!
        .scheduleEntries.filter((e) => e.startDate === tomorrow),
    ).toHaveLength(1);
    void jordan;
  });

  it("AT19 race: first-action then revise freezes; revise then first-action locks new structure", async () => {
    // Ordering A — lock first, then revise (same day).
    {
      const { store } = freshStore();
      const manager = await claimManager(store);
      const child = await enrollAndClaim(
        store,
        manager.context,
        IDS.avery,
        "direct_personalizer",
        `av.race.a.${Date.now().toString(36)}`,
        "Avery Reed",
      );
      const routine = store.createRoutine(manager.context, {
        mutationId: randomUUID(),
        title: "Race Routine A",
        daypart: "anytime",
        assigneeMemberIds: [IDS.avery],
        assigneeGroupIds: [],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps: [
          { text: "Original required", obligation: "required" },
          { text: "As needed item", obligation: "as_needed" },
        ],
      });
      const today = store.householdDateNow(manager.context);
      const occ = store.materializeForDate(manager.context, today).find(
        (o) => o.accountableMemberId === IDS.avery,
      )!;
      const asNeeded = occ.steps.find((s) => s.obligation === "as_needed")!;
      store.setStepStatus(child.context, occ.id, asNeeded.id, {
        mutationId: randomUUID(),
        status: "not_needed",
        performedAt: new Date().toISOString(),
      });
      expect(store.getOccurrenceById(occ.id)!.startedAt).toBeTruthy();
      store.createRevision(manager.context, routine.id, {
        mutationId: randomUUID(),
        title: "After Lock",
        daypart: "anytime",
        assigneeMemberIds: [IDS.avery],
        assigneeGroupIds: [],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps: [{ text: "Should not apply", obligation: "required" }],
        expectedVersion: store.getRoutineById(manager.context.householdId, routine.id)!.version,
        effectiveDate: today,
      });
      expect(store.getOccurrenceById(occ.id)!.steps[0]!.text).toBe("Original required");
    }

    // Ordering B — revise first, then lock (same day, fresh household).
    {
      const { store } = freshStore();
      const manager = await claimManager(store);
      const child = await enrollAndClaim(
        store,
        manager.context,
        IDS.avery,
        "direct_personalizer",
        `av.race.b.${Date.now().toString(36)}`,
        "Avery Reed",
      );
      const routine = store.createRoutine(manager.context, {
        mutationId: randomUUID(),
        title: "Race Routine B",
        daypart: "anytime",
        assigneeMemberIds: [IDS.avery],
        assigneeGroupIds: [],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps: [{ text: "Seed", obligation: "required" }],
      });
      const today = store.householdDateNow(manager.context);
      store.materializeForDate(manager.context, today);
      store.createRevision(manager.context, routine.id, {
        mutationId: randomUUID(),
        title: "Before Lock",
        daypart: "anytime",
        assigneeMemberIds: [IDS.avery],
        assigneeGroupIds: [],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps: [{ text: "Revised first", obligation: "required" }],
        expectedVersion: store.getRoutineById(manager.context.householdId, routine.id)!.version,
        effectiveDate: today,
      });
      const occ = store
        .materializeForDate(manager.context, today)
        .find((o) => o.accountableMemberId === IDS.avery)!;
      expect(occ.steps[0]!.text).toBe("Revised first");
      expect(occ.startedAt).toBeNull();
      store.setStepStatus(child.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
      });
      expect(store.getOccurrenceById(occ.id)!.startedAt).toBeTruthy();
      store.createRevision(manager.context, routine.id, {
        mutationId: randomUUID(),
        title: "Too Late",
        daypart: "anytime",
        assigneeMemberIds: [IDS.avery],
        assigneeGroupIds: [],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps: [{ text: "Ignored", obligation: "required" }],
        expectedVersion: store.getRoutineById(manager.context.householdId, routine.id)!.version,
        effectiveDate: today,
      });
      expect(store.getOccurrenceById(occ.id)!.steps[0]!.text).toBe("Revised first");
    }
  });
});

describe("P0-005 r3 schedule lifecycle", () => {
  it("current-plan range updates today and known tomorrow but not scheduled B", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const today = store.householdDateNow(manager.context);
    const tomorrow = addHouseholdDays(today, 1);
    const dayAfter = addHouseholdDays(today, 2);
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Plan A",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    store.materializeForDate(manager.context, today);
    store.materializeForDate(manager.context, tomorrow);
    const scheduled = store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Plan B",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "B step", obligation: "required" }],
      expectedVersion: routine.version,
      mode: "schedule",
      effectiveDate: dayAfter,
    });
    expect(scheduled.routine.scheduleEntries).toHaveLength(2);

    const refined = store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Plan A refined",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "A step refined", obligation: "required" }],
      expectedVersion: scheduled.routine.version,
      mode: "current",
    });
    expect(refined.refineOutcome?.untilDateExclusive).toBe(dayAfter);

    const todayOcc = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === routine.id)!;
    const tomorrowOcc = store
      .materializeForDate(manager.context, tomorrow)
      .find((o) => o.definitionId === routine.id)!;
    const bOcc = store
      .materializeForDate(manager.context, dayAfter)
      .find((o) => o.definitionId === routine.id)!;
    expect(todayOcc.title).toBe("Plan A refined");
    expect(tomorrowOcc.title).toBe("Plan A refined");
    expect(bOcc.title).toBe("Plan B");
  });

  it("schedule create/edit thrice on same date keeps one entry", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const today = store.householdDateNow(manager.context);
    const start = addHouseholdDays(today, 3);
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Base",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    let version = routine.version;
    let entryId: string | undefined;
    for (const title of ["S1", "S2", "S3"]) {
      const result = store.createRevision(manager.context, routine.id, {
        mutationId: randomUUID(),
        title,
        daypart: "anytime",
        assigneeMemberIds: [IDS.morgan],
        assigneeGroupIds: [],
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        steps: [{ text: title, obligation: "required" }],
        expectedVersion: version,
        mode: "schedule",
        effectiveDate: start,
        ...(entryId ? { scheduleEntryId: entryId } : {}),
      });
      version = result.routine.version;
      entryId = result.routine.scheduleEntries.find((e) => e.startDate === start)!.id;
      expect(result.routine.scheduleEntries.filter((e) => e.startDate === start)).toHaveLength(
        1,
      );
    }
    const final = store.getRoutineById(manager.context.householdId, routine.id)!;
    expect(final.scheduleEntries).toHaveLength(2);
    expect(final.scheduleEntries.find((e) => e.startDate === start)!.revision.title).toBe("S3");
  });

  it("delete upcoming B in A/B/C restores A until C", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const today = store.householdDateNow(manager.context);
    const bDate = addHouseholdDays(today, 2);
    const cDate = addHouseholdDays(today, 4);
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "A",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "A", obligation: "required" }],
    });
    const withB = store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "B",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "B", obligation: "required" }],
      expectedVersion: routine.version,
      mode: "schedule",
      effectiveDate: bDate,
    });
    const withC = store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "C",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "C", obligation: "required" }],
      expectedVersion: withB.routine.version,
      mode: "schedule",
      effectiveDate: cDate,
    });
    const bEntry = withC.routine.scheduleEntries.find((e) => e.startDate === bDate)!;
    store.materializeForDate(manager.context, bDate);
    const deleted = store.deleteScheduleEntry(manager.context, routine.id, bEntry.id, {
      mutationId: randomUUID(),
      expectedVersion: withC.routine.version,
    });
    expect(deleted.routine.scheduleEntries.map((e) => e.startDate).sort()).toEqual(
      [today, cDate].sort(),
    );
    expect(
      store.materializeForDate(manager.context, bDate).find((o) => o.definitionId === routine.id)
        ?.title,
    ).toBe("A");
    expect(
      store.materializeForDate(manager.context, cDate).find((o) => o.definitionId === routine.id)
        ?.title,
    ).toBe("C");
  });

  it("end cancels today unstarted and keeps started", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `av.end.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const jordan = await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jo.end.${Date.now().toString(36)}`,
      "Jordan Reed",
    );
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "End me",
      daypart: "anytime",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const today = store.householdDateNow(manager.context);
    const occs = store.materializeForDate(manager.context, today);
    const averyOcc = occs.find((o) => o.accountableMemberId === IDS.avery)!;
    store.setStepStatus(avery.context, averyOcc.id, averyOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    const ended = store.endRoutine(manager.context, routine.id, {
      mutationId: randomUUID(),
      expectedVersion: routine.version,
    });
    expect(ended.routine.ended).toBe(true);
    expect(ended.routine.endMode).toBe("immediate");
    const after = store.materializeForDate(manager.context, today);
    expect(after.find((o) => o.accountableMemberId === IDS.avery)?.startedAt).toBeTruthy();
    expect(after.find((o) => o.accountableMemberId === IDS.jordan)).toBeUndefined();
    void jordan;
  });

  it("delete unused succeeds; delete with started is forbidden", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const unused = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Unused",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const deleted = store.deleteRoutine(manager.context, unused.id, {
      mutationId: randomUUID(),
      expectedVersion: unused.version,
    });
    expect(deleted.deleted).toBe(true);
    expect(() => store.getRoutineById(manager.context.householdId, unused.id)).toThrow(
      /not found/i,
    );

    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `av.del.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const used = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Used",
      daypart: "anytime",
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const today = store.householdDateNow(manager.context);
    const occ = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === used.id)!;
    store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    expect(() =>
      store.deleteRoutine(manager.context, used.id, {
        mutationId: randomUUID(),
        expectedVersion: used.version,
      }),
    ).toThrow(/started work/i);
  });

  it("started occurrence stays visible after audience removal", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `av.vis.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const _jordan = await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jo.vis.${Date.now().toString(36)}`,
      "Jordan Reed",
    );
    void _jordan;
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Audience",
      daypart: "anytime",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
    });
    const today = store.householdDateNow(manager.context);
    const before = store.materializeForDate(manager.context, today);
    const averyOcc = before.find((o) => o.accountableMemberId === IDS.avery)!;
    store.setStepStatus(avery.context, averyOcc.id, averyOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Audience Jordan only",
      daypart: "anytime",
      assigneeMemberIds: [IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps,
      expectedVersion: routine.version,
      mode: "current",
    });
    const after = store.materializeForDate(manager.context, today);
    expect(after.find((o) => o.accountableMemberId === IDS.avery)?.id).toBe(averyOcc.id);
    expect(after.find((o) => o.accountableMemberId === IDS.jordan)).toBeTruthy();
    // Avery can still mutate started occurrence after removal from live audience.
    store.setStepStatus(avery.context, averyOcc.id, averyOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "open",
      performedAt: new Date().toISOString(),
    });
    expect(store.getOccurrenceById(averyOcc.id)!.startedAt).toBeTruthy();
  });

  it("move upcoming to today promotes plan and preserves started peers", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `av.move.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const jordan = await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jo.move.${Date.now().toString(36)}`,
      "Jordan Reed",
    );
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Current A",
      daypart: "anytime",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "A step", obligation: "required" }],
    });
    const today = store.householdDateNow(manager.context);
    const future = addHouseholdDays(today, 2);
    const scheduled = store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Future B",
      daypart: "anytime",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "B step", obligation: "required" }],
      expectedVersion: routine.version,
      mode: "schedule",
      effectiveDate: future,
    });
    const todayOccs = store.materializeForDate(manager.context, today);
    const averyOcc = todayOccs.find((o) => o.accountableMemberId === IDS.avery)!;
    store.setStepStatus(avery.context, averyOcc.id, averyOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
    });
    const entry = scheduled.routine.scheduleEntries.find((e) => e.startDate === future)!;
    const moved = store.moveScheduleEntry(manager.context, routine.id, entry.id, {
      mutationId: randomUUID(),
      expectedVersion: scheduled.routine.version,
      startDate: today,
    });
    expect(moved.routine.scheduleEntries.some((e) => e.startDate === future)).toBe(false);
    expect(moved.refineOutcome?.protectedMemberIds).toContain(IDS.avery);
    const after = store.materializeForDate(manager.context, today);
    expect(after.find((o) => o.accountableMemberId === IDS.avery)?.title).toBe("Current A");
    expect(after.find((o) => o.accountableMemberId === IDS.jordan)?.title).toBe("Future B");
    void jordan;
  });

  it("008 repairs narrow receipt kinds so upcoming delete succeeds on long-lived DBs", async () => {
    const dbPath = path.join(
      os.tmpdir(),
      `hd-005-receipt-repair-${Date.now()}.sqlite`,
    );
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    migrate(db);

    // Simulate the production failure mode: 007 applied, but receipts still use the
    // pre-r3 CHECK that rejects routine_schedule_delete (HTTP 500 / unexpected error).
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE routine_mutation_receipts_narrow (
        mutation_id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        definition_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN (
          'routine_create',
          'routine_revision',
          'routine_archive'
        )),
        payload_digest TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO routine_mutation_receipts_narrow
        (mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at)
      SELECT mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at
      FROM routine_mutation_receipts;
      DROP TABLE routine_mutation_receipts;
      ALTER TABLE routine_mutation_receipts_narrow RENAME TO routine_mutation_receipts;
    `);
    db.prepare("DELETE FROM schema_migrations WHERE id = ?").run(
      "008_widen_routine_mutation_receipt_kinds.sql",
    );
    db.pragma("foreign_keys = ON");

    const narrowSql = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name = 'routine_mutation_receipts'",
        )
        .get() as { sql: string }
    ).sql;
    expect(narrowSql).not.toContain("routine_schedule_delete");
    expect(() =>
      db
        .prepare(
          `INSERT INTO routine_mutation_receipts
           (mutation_id, household_id, definition_id, kind, payload_digest, response_json, created_at)
           VALUES (?, 'h', 'd', 'routine_schedule_delete', 'x', '{}', datetime('now'))`,
        )
        .run(randomUUID()),
    ).toThrow(/CHECK constraint failed/i);

    migrate(db);

    const repairedSql = (
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE name = 'routine_mutation_receipts'",
        )
        .get() as { sql: string }
    ).sql;
    expect(repairedSql).toContain("routine_schedule_delete");
    expect(repairedSql).toContain("routine_schedule_move");
    expect(repairedSql).toContain("routine_end");

    const store = new AppStore(db);
    store.seed("America/New_York");
    const manager = await claimManager(store);
    const today = store.householdDateNow(manager.context);
    const tomorrow = addHouseholdDays(today, 1);
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Receipt Repair",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Current step", obligation: "required" }],
    });
    const scheduled = store.createRevision(manager.context, routine.id, {
      mutationId: randomUUID(),
      title: "Upcoming B",
      daypart: "anytime",
      assigneeMemberIds: [IDS.morgan],
      assigneeGroupIds: [],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Future step", obligation: "required" }],
      expectedVersion: routine.version,
      mode: "schedule",
      effectiveDate: tomorrow,
    });
    const entry = scheduled.routine.scheduleEntries.find((e) => e.startDate === tomorrow)!;
    store.materializeForDate(manager.context, tomorrow);
    expect(
      store
        .materializeForDate(manager.context, tomorrow)
        .find((o) => o.definitionId === routine.id)?.title,
    ).toBe("Upcoming B");

    const deleted = store.deleteScheduleEntry(manager.context, routine.id, entry.id, {
      mutationId: randomUUID(),
      expectedVersion: scheduled.routine.version,
    });
    expect(deleted.routine.scheduleEntries.some((e) => e.id === entry.id)).toBe(false);
    expect(deleted.routine.scheduleEntries.some((e) => e.startDate === tomorrow)).toBe(
      false,
    );
    expect(
      store
        .materializeForDate(manager.context, tomorrow)
        .find((o) => o.definitionId === routine.id)?.title,
    ).toBe("Receipt Repair");
    expect(() =>
      store.deleteScheduleEntry(manager.context, routine.id, entry.id, {
        mutationId: randomUUID(),
        expectedVersion: deleted.routine.version,
      }),
    ).toThrow(/not found/i);
  });
});
