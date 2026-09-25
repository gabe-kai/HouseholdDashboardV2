import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { opportunityIndexForDate } from "../../src/domain/responsibility-assignment.js";
import {
  householdDateFromInstant,
  isoWeekdayForHouseholdDate,
} from "../../src/domain/time.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { evaluateMembership } from "../../src/server/scripts/cleanup-fixtures.js";
import { SEED } from "../../src/server/seeds/evaluation.js";
import { AppStore } from "../../src/server/store.js";
import {
  authHeaders,
  claimManager,
  createHttpHarness,
  enrollAndClaim,
  httpClaimManager,
  IDS,
  sessionFromResponse,
} from "../helpers/auth-fixture.js";
import {
  openPopulatedP013UpgradeDatabase,
  P013_FIXTURE_IDS,
} from "../helpers/p013-fixture.js";

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
    `hd-007b-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { store, db, dbPath };
}

function requiredStep(text: string, logicalItemId?: string) {
  return {
    text,
    obligation: "required" as const,
    logicalItemId: logicalItemId ?? randomUUID(),
  };
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d! + days, 12, 0, 0));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const day = utc.getUTCDay();
  return day === 0 ? 7 : day;
}

function dbCounts(db: import("better-sqlite3").Database) {
  return {
    definitions: (db.prepare(`SELECT COUNT(*) AS c FROM routine_definitions`).get() as { c: number })
      .c,
    revisions: (db.prepare(`SELECT COUNT(*) AS c FROM routine_revisions`).get() as { c: number }).c,
    occurrences: (db.prepare(`SELECT COUNT(*) AS c FROM occurrences`).get() as { c: number }).c,
    occurrenceSteps: (db.prepare(`SELECT COUNT(*) AS c FROM occurrence_steps`).get() as { c: number })
      .c,
    plans: (
      db.prepare(`SELECT COUNT(*) AS c FROM revision_responsibility_plans`).get() as { c: number }
    ).c,
    receipts: (
      db.prepare(`SELECT COUNT(*) AS c FROM routine_mutation_receipts`).get() as { c: number }
    ).c,
  };
}

describe("P0-007B assignment patterns and scheduled work (server)", () => {
  it("AT1: populated through-013 upgrades through 014 with fixed plan maps", async () => {
    const dbPath = path.join(os.tmpdir(), `hd-007b-p013-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP013UpgradeDatabase(dbPath);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '014_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare(
            `SELECT 1 AS ok FROM occurrences WHERE id = ? AND kind = 'responsibility'`,
          )
          .get(P013_FIXTURE_IDS.catsOccStartedId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            `SELECT accountable_member_id FROM occurrences WHERE id = ?`,
          )
          .get(P013_FIXTURE_IDS.catsOccStartedId) as { accountable_member_id: string }
      ).accountable_member_id,
    ).toBe(P013_FIXTURE_IDS.averyId);

    const preUpgrade = db
      .prepare(
        `SELECT activity_generation, activity_reset_floor FROM households WHERE id = ?`,
      )
      .get(P013_FIXTURE_IDS.householdId) as {
      activity_generation: number;
      activity_reset_floor: string | null;
    };
    expect(preUpgrade.activity_generation).toBe(3);
    expect(preUpgrade.activity_reset_floor).toBe("2026-09-10");

    migrate(db);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '014_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(15);

    const catsPlan = db
      .prepare(
        `SELECT assignment_json FROM revision_responsibility_plans WHERE revision_id = ?`,
      )
      .get(P013_FIXTURE_IDS.catsRevisionId) as { assignment_json: string };
    const trashPlan = db
      .prepare(
        `SELECT assignment_json FROM revision_responsibility_plans WHERE revision_id = ?`,
      )
      .get(P013_FIXTURE_IDS.trashRevisionId) as { assignment_json: string };
    expect(JSON.parse(catsPlan.assignment_json)).toMatchObject({
      mode: "fixed",
      fixedMemberId: P013_FIXTURE_IDS.averyId,
    });
    expect(JSON.parse(trashPlan.assignment_json)).toMatchObject({
      mode: "fixed",
      fixedMemberId: P013_FIXTURE_IDS.averyId,
    });

    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);

    migrate(db);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(15);

    db.close();
    const restarted = openDatabase(dbPath);
    migrate(restarted);
    const store = new AppStore(restarted);
    const morganGrants = (
      restarted
        .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
        .all(P013_FIXTURE_IDS.morganId) as Array<{ grant_name: string }>
    ).map((row) => row.grant_name);
    const morganCtx = {
      sessionId: randomUUID(),
      userId: randomUUID(),
      householdId: P013_FIXTURE_IDS.householdId,
      membershipId: P013_FIXTURE_IDS.morganId,
      displayName: "Morgan Reed",
      grants: morganGrants as Awaited<ReturnType<typeof claimManager>>["context"]["grants"],
      timezone: "America/New_York",
      csrfSecret: "test",
    };

    const created = store.createResponsibility(morganCtx, {
      mutationId: randomUUID(),
      title: "Post-upgrade Kitchen",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "weekly",
        anchorDate: "2026-09-01",
        weeklyMap: {
          1: P013_FIXTURE_IDS.averyId,
          2: P013_FIXTURE_IDS.caseyId,
          3: P013_FIXTURE_IDS.averyId,
          4: P013_FIXTURE_IDS.caseyId,
          5: P013_FIXTURE_IDS.jordanId,
          6: P013_FIXTURE_IDS.averyId,
          7: P013_FIXTURE_IDS.caseyId,
        },
      },
      steps: [requiredStep("Counters")],
    });
    expect(created.id).toBeTruthy();

    const backupPath = path.join(os.tmpdir(), `hd-007b-bak-${Date.now()}.sqlite`);
    const restorePath = path.join(os.tmpdir(), `hd-007b-restore-${Date.now()}.sqlite`);
    temps.push(backupPath, restorePath);
    await restarted.backup(backupPath);
    restarted.close();
    const migratedBackup = openDatabase(backupPath);
    await migratedBackup.backup(restorePath);
    migratedBackup.close();
    const restored = openDatabase(restorePath);
    expect(
      (
        restored
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '014_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        restored
          .prepare(
            `SELECT 1 AS ok FROM revision_responsibility_plans WHERE revision_id = ?`,
          )
          .get(P013_FIXTURE_IDS.catsRevisionId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);
    expect((restored.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);
    restored.close();
  });

  it("AT2: assignment oracle — fixed, take turns, weekly, anchor, group ring", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.oracle.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.casey,
      "direct_personalizer",
      `casey.oracle.${Date.now().toString(36)}`,
      "Casey Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jordan.oracle.${Date.now().toString(36)}`,
      "Jordan Reed",
    );

    const today = store.householdDateNow(manager.context);
    let tuesday = today;
    while (isoWeekday(tuesday) !== 2) {
      tuesday = addDays(tuesday, -1);
    }
    const anchor = tuesday;
    const fixed = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Fixed Trash",
      daypart: "evening",
      weekdays: [2],
      assignment: {
        mode: "fixed",
        anchorDate: anchor,
        fixedMemberId: IDS.avery,
      },
      steps: [requiredStep("Take out")],
    });
    db.prepare(`UPDATE routine_revisions SET effective_date = ? WHERE definition_id = ?`).run(
      tuesday,
      fixed.id,
    );
    db.prepare(`UPDATE routine_schedule_entries SET start_date = ? WHERE definition_id = ?`).run(
      tuesday,
      fixed.id,
    );
    const fixedOcc = store.materializeForDate(manager.context, tuesday).find(
      (o) => o.definitionId === fixed.id,
    )!;
    expect(fixedOcc.accountableMemberId).toBe(IDS.avery);

    let cycleAnchor = today;
    while (isoWeekday(cycleAnchor) !== 1) {
      cycleAnchor = addDays(cycleAnchor, -1);
    }
    const mon = cycleAnchor;
    const wed = addDays(cycleAnchor, 2);
    const cycle = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Cats cycle",
      daypart: "anytime",
      weekdays: [1, 3, 5],
      assignment: {
        mode: "take_turns",
        anchorDate: mon,
        cycleOrder: [IDS.avery, IDS.casey, IDS.jordan],
      },
      steps: [requiredStep("Feed")],
    });
    db.prepare(`UPDATE routine_revisions SET effective_date = ? WHERE definition_id = ?`).run(
      mon,
      cycle.id,
    );
    db.prepare(`UPDATE routine_schedule_entries SET start_date = ? WHERE definition_id = ?`).run(
      mon,
      cycle.id,
    );
    const monOwner = store
      .materializeForDate(manager.context, mon)
      .find((o) => o.definitionId === cycle.id)?.accountableMemberId;
    const wedOwner = store
      .materializeForDate(manager.context, wed)
      .find((o) => o.definitionId === cycle.id)?.accountableMemberId;
    expect(monOwner).toBe(IDS.avery);
    expect(wedOwner).toBe(IDS.casey);

    const weekly = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Kitchen weekly",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "weekly",
        anchorDate: anchor,
        weeklyMap: {
          1: IDS.avery,
          2: IDS.casey,
          3: IDS.avery,
          4: IDS.casey,
          5: IDS.jordan,
          6: IDS.avery,
          7: IDS.casey,
        },
      },
      steps: [requiredStep("Counters")],
    });
    const satPreview = store
      .previewResponsibilityNextDays(manager.context, weekly.id, 14)
      .find((day) => isoWeekday(day.householdDate) === 6 && day.applicable);
    expect(satPreview?.accountableMemberId).toBe(IDS.avery);

    const group = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: `Kids ${Date.now().toString(36)}`,
      membershipIds: [IDS.avery, IDS.casey, IDS.jordan],
    });
    const groupCycle = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Group ring",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: mon,
        sourceGroupId: group.id,
        savedRingOrder: [IDS.casey, IDS.avery, IDS.jordan],
      },
      steps: [requiredStep("Dishes")],
    });
    const ringPreview = store.previewResponsibilityNextDays(manager.context, groupCycle.id, 3);
    expect(ringPreview.filter((day) => day.applicable).length).toBeGreaterThan(0);
    expect(ringPreview.some((day) => day.accountableMemberId === IDS.casey)).toBe(true);

    const repeatPreview = store.previewResponsibilityNextDays(manager.context, groupCycle.id, 3);
    expect(repeatPreview).toEqual(ringPreview);
  });

  it("AT3: preview read isolation — no writes before/after saved and draft previews", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.preview.${Date.now().toString(36)}`,
      "Avery Reed",
    );

    const cats = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Preview Cats",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Feed")],
    });
    const today = store.householdDateNow(manager.context);
    store.materializeForDate(manager.context, today);

    const before = dbCounts(db);
    store.previewResponsibilityNextDays(manager.context, cats.id, 7);
    store.previewDraftResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Draft Kitchen",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: today,
        cycleOrder: [IDS.avery, IDS.jordan],
      },
      steps: [requiredStep("Counters")],
      scheduledAdditions: [
        {
          name: "Deep clean",
          weekdays: [6],
          inheritAssignment: false,
          assignment: {
            mode: "take_turns",
            anchorDate: today,
            cycleOrder: [IDS.avery, IDS.casey],
          },
          steps: [requiredStep("Oven")],
        },
      ],
    });
    expect(dbCounts(db)).toEqual(before);

    const preview = store.previewResponsibilityNextDays(manager.context, cats.id, 7);
    const materialized = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === cats.id)!;
    const todayPreview = preview.find((day) => day.householdDate === today);
    expect(todayPreview?.accountableMemberId).toBe(materialized.accountableMemberId);
  });

  it("AT7: Unassigned materialization and execution forbidden", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);

    const group = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: `Empty ring ${Date.now().toString(36)}`,
      membershipIds: [IDS.avery, IDS.casey, IDS.jordan],
    });
    const unassigned = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Empty cycle",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: store.householdDateNow(manager.context),
        sourceGroupId: group.id,
        savedRingOrder: [IDS.avery, IDS.casey, IDS.jordan],
        excludedMemberIds: [IDS.avery, IDS.casey, IDS.jordan],
      },
      steps: [requiredStep("Feed")],
    });
    const today = store.householdDateNow(manager.context);
    const occ = store.materializeForDate(manager.context, today).find(
      (o) => o.definitionId === unassigned.id,
    )!;
    expect(occ.accountableMemberId).toBeNull();
    expect(
      (
        db
          .prepare(`SELECT unassigned_reason FROM occurrences WHERE id = ?`)
          .get(occ.id) as { unassigned_reason: string | null }
      ).unassigned_reason,
    ).toBeTruthy();

    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.unassigned.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    expect(() =>
      store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
        kind: "responsibility",
        intendedStructure: {
          revisionId: occ.revisionId,
          accountableMemberId: IDS.avery,
          stepLogicalIds: occ.steps.map((s) => s.logicalItemId!),
        },
      }),
    ).toThrow(/Unassigned|forbidden|accountable/i);

    const occIdBefore = occ.id;
    store.createResponsibilityRevision(manager.context, unassigned.id, {
      mutationId: randomUUID(),
      title: "Empty cycle",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "fixed",
        anchorDate: today,
        fixedMemberId: IDS.avery,
      },
      steps: [requiredStep("Feed")],
      expectedVersion: unassigned.version,
      mode: "current",
    });
    const repaired = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === unassigned.id)!;
    expect(repaired.id).toBe(occIdBefore);
    expect(repaired.accountableMemberId).toBe(IDS.avery);
  });

  it("AT8: overlap rejection for owner-setting scheduled work additions", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.overlap.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.casey,
      "direct_personalizer",
      `casey.overlap.${Date.now().toString(36)}`,
      "Casey Reed",
    );

    const anchor = store.householdDateNow(manager.context);
    expect(() =>
      store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Overlap Kitchen",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: anchor,
          fixedMemberId: IDS.avery,
        },
        steps: [requiredStep("Counters")],
        scheduledAdditions: [
          {
            name: "Deep clean",
            weekdays: [6],
            inheritAssignment: false,
            assignment: {
              mode: "fixed",
              anchorDate: anchor,
              fixedMemberId: IDS.avery,
            },
            steps: [requiredStep("Oven")],
          },
          {
            name: "Other Saturday",
            weekdays: [6, 7],
            inheritAssignment: false,
            assignment: {
              mode: "fixed",
              anchorDate: anchor,
              fixedMemberId: IDS.casey,
            },
            steps: [requiredStep("Mop")],
          },
        ],
      }),
    ).toThrow(/overlap|ownership/i);
  });

  it("AT10: stale intent rejected when structure fingerprint differs", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.fp.${Date.now().toString(36)}`,
      "Avery Reed",
    );

    const kitchen = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Fingerprint Kitchen",
      daypart: "anytime",
      accountableMemberId: IDS.avery,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [requiredStep("Counters"), requiredStep("Dishes")],
    });
    const today = store.householdDateNow(manager.context);
    const occ = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === kitchen.id)!;
    const logicalIds = occ.steps.map((s) => s.logicalItemId!).filter(Boolean);

    expect(() =>
      store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
        kind: "responsibility",
        intendedStructure: {
          revisionId: occ.revisionId,
          accountableMemberId: IDS.avery,
          stepLogicalIds: logicalIds,
          structureFingerprint: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        },
      }),
    ).toThrow(/changed|structure|intent|stale|refresh/i);
  });

  it("AT2b: schedule move/delete preserves anchors; DST/travel TZ; restart; reset; group arbitration", async () => {
    const { store, db, dbPath } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.at2b.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.casey,
      "direct_personalizer",
      `casey.at2b.${Date.now().toString(36)}`,
      "Casey Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jordan.at2b.${Date.now().toString(36)}`,
      "Jordan Reed",
    );

    const today = store.householdDateNow(manager.context);
    let mon = today;
    while (isoWeekday(mon) !== 1) {
      mon = addDays(mon, -1);
    }
    const weekdays = [1, 3, 5];
    const originalAnchor = mon;
    const cycle = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Cats AT2b",
      daypart: "anytime",
      weekdays,
      assignment: {
        mode: "take_turns",
        anchorDate: originalAnchor,
        cycleOrder: [IDS.avery, IDS.casey, IDS.jordan],
      },
      steps: [requiredStep("Feed")],
    });
    db.prepare(`UPDATE routine_revisions SET effective_date = ? WHERE definition_id = ?`).run(
      mon,
      cycle.id,
    );
    db.prepare(`UPDATE routine_schedule_entries SET start_date = ? WHERE definition_id = ?`).run(
      mon,
      cycle.id,
    );

    const sampleDates = [mon, addDays(mon, 2), addDays(mon, 4)].filter(
      (d) => isoWeekday(d) === 1 || isoWeekday(d) === 3 || isoWeekday(d) === 5,
    );
    const originalOwners = sampleDates.map((date) => {
      const occ = store.materializeForDate(manager.context, date).find(
        (o) => o.definitionId === cycle.id,
      );
      return { date, owner: occ?.accountableMemberId ?? null };
    });
    const originalIndexes = sampleDates.map((date) =>
      opportunityIndexForDate(originalAnchor, date, weekdays),
    );

    const tomorrow = addDays(today, 1);
    const dayAfter = addDays(today, 2);
    const current = store.getResponsibilityById(manager.context.householdId, cycle.id);
    const scheduled = store.createResponsibilityRevision(manager.context, cycle.id, {
      mutationId: randomUUID(),
      title: "Cats AT2b scheduled",
      daypart: "anytime",
      weekdays,
      assignment: {
        mode: "take_turns",
        anchorDate: tomorrow,
        cycleOrder: [IDS.jordan, IDS.avery, IDS.casey],
      },
      steps: [requiredStep("Feed")],
      expectedVersion: current.version,
      mode: "schedule",
      effectiveDate: tomorrow,
    });
    const futureEntry = scheduled.responsibility.scheduleEntries.find(
      (e) => e.startDate === tomorrow,
    )!;
    expect(futureEntry).toBeTruthy();

    const moved = store.moveResponsibilityScheduleEntry(
      manager.context,
      cycle.id,
      futureEntry.id,
      {
        mutationId: randomUUID(),
        expectedVersion: scheduled.responsibility.version,
        startDate: dayAfter,
      },
    );
    expect(
      moved.responsibility.scheduleEntries.some((e) => e.startDate === dayAfter && !e.canceledAt),
    ).toBe(true);
    const movedRevision = moved.responsibility.scheduleEntries.find(
      (e) => e.id === futureEntry.id && !e.canceledAt,
    )?.revision;
    expect(movedRevision?.assignment?.anchorDate).toBe(dayAfter);

    const afterMove = store.getResponsibilityById(manager.context.householdId, cycle.id);
    const deleted = store.deleteResponsibilityScheduleEntry(
      manager.context,
      cycle.id,
      futureEntry.id,
      {
        mutationId: randomUUID(),
        expectedVersion: afterMove.version,
      },
    );
    expect(
      deleted.responsibility.scheduleEntries.some((e) => e.id === futureEntry.id && !e.canceledAt),
    ).toBe(false);

    const restored = store.getResponsibilityById(manager.context.householdId, cycle.id);
    const activeRevision = restored.scheduleEntries.find(
      (e) => !e.canceledAt && e.startDate <= today,
    )?.revision;
    expect(activeRevision?.assignment?.anchorDate).toBe(originalAnchor);
    for (let i = 0; i < sampleDates.length; i++) {
      const date = sampleDates[i]!;
      if (date < today) continue;
      const occ = store.materializeForDate(manager.context, date).find(
        (o) => o.definitionId === cycle.id,
      );
      expect(occ?.accountableMemberId).toBe(originalOwners[i]!.owner);
      expect(opportunityIndexForDate(originalAnchor, date, weekdays)).toBe(originalIndexes[i]);
    }

    // DST / travel TZ: household-local weekday assignment stays deterministic.
    const springInstant = new Date("2024-03-10T08:00:00.000Z");
    const nyDate = store.householdDateNow(
      { ...manager.context, timezone: "America/New_York" },
      springInstant,
    );
    expect(nyDate).toBe("2024-03-10");
    expect(isoWeekdayForHouseholdDate(nyDate)).toBe(7);
    const travelDate = householdDateFromInstant(springInstant, "America/Los_Angeles");
    expect(isoWeekday(travelDate)).toBe(isoWeekdayForHouseholdDate(nyDate));
    const weeklyMap = {
      1: IDS.avery,
      2: IDS.casey,
      3: IDS.avery,
      4: IDS.casey,
      5: IDS.jordan,
      6: IDS.avery,
      7: IDS.casey,
    };
    store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Weekly DST",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: { mode: "weekly", anchorDate: "2024-03-04", weeklyMap },
      steps: [requiredStep("Wipe")],
    });
    const draftPreview = store.previewDraftResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Draft weekly DST",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: { mode: "weekly", anchorDate: "2024-03-04", weeklyMap },
      steps: [requiredStep("Wipe")],
    });
    expect(draftPreview.some((d) => d.applicable && d.accountableMemberId)).toBe(true);

    // Restart preserves durable anchors.
    db.close();
    const restartedDb = openDatabase(dbPath);
    migrate(restartedDb);
    const restarted = new AppStore(restartedDb);
    const planRow = restartedDb
      .prepare(
        `SELECT rrp.assignment_json
         FROM revision_responsibility_plans rrp
         JOIN routine_revisions rr ON rr.id = rrp.revision_id
         WHERE rr.definition_id = ?
         ORDER BY rr.effective_date ASC LIMIT 1`,
      )
      .get(cycle.id) as { assignment_json: string };
    expect(JSON.parse(planRow.assignment_json).anchorDate).toBe(originalAnchor);

    const morganGrants = (
      restartedDb
        .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
        .all(IDS.morgan) as Array<{ grant_name: string }>
    ).map((row) => row.grant_name);
    const morganCtx = {
      sessionId: randomUUID(),
      userId: randomUUID(),
      householdId: manager.context.householdId,
      membershipId: IDS.morgan,
      displayName: "Morgan Reed",
      grants: morganGrants as typeof manager.context.grants,
      timezone: "America/New_York",
      csrfSecret: "test",
    };
    const previewA = restarted.previewResponsibilityNextDays(morganCtx, cycle.id, 7);
    const previewB = restarted.previewResponsibilityNextDays(morganCtx, cycle.id, 7);
    expect(previewB).toEqual(previewA);
    const futurePhase = previewA
      .filter((d) => d.applicable && d.householdDate > restarted.householdDateNow(morganCtx))
      .map((d) => ({ date: d.householdDate, owner: d.accountableMemberId }));

    const todayOcc = restarted
      .materializeForDate(morganCtx, restarted.householdDateNow(morganCtx))
      .find((o) => o.definitionId === cycle.id);
    const ownerId = todayOcc?.accountableMemberId;
    if (todayOcc && ownerId) {
      const ownerGrants = (
        restartedDb
          .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
          .all(ownerId) as Array<{ grant_name: string }>
      ).map((row) => row.grant_name);
      restarted.setStepStatus(
        {
          sessionId: randomUUID(),
          userId: randomUUID(),
          householdId: morganCtx.householdId,
          membershipId: ownerId,
          displayName: "Owner",
          grants: ownerGrants as typeof morganCtx.grants,
          timezone: morganCtx.timezone,
          csrfSecret: "test",
        },
        todayOcc.id,
        todayOcc.steps[0]!.id,
        {
          mutationId: randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: 0,
          kind: "responsibility",
          intendedStructure: {
            revisionId: todayOcc.revisionId,
            accountableMemberId: ownerId,
            stepLogicalIds: todayOcc.steps.map((s) => s.logicalItemId!),
          },
        },
      );
    }

    restarted.clearRoutineActivity(morganCtx, {
      mutationId: randomUUID(),
      expectedGeneration: 0,
      acknowledgedScope: "routines_and_responsibilities",
    });
    const afterClear = restarted.previewResponsibilityNextDays(morganCtx, cycle.id, 7);
    const rematerializedPhase = afterClear
      .filter((d) => d.applicable && d.householdDate > restarted.householdDateNow(morganCtx))
      .map((d) => ({ date: d.householdDate, owner: d.accountableMemberId }));
    expect(rematerializedPhase).toEqual(futurePhase);

    // Group arbitration: next-day reconcile updates unstarted future; today/started protected.
    const group = restarted.createGroup(morganCtx, {
      mutationId: randomUUID(),
      name: `Kids AT2b ${Date.now().toString(36)}`,
      membershipIds: [IDS.avery, IDS.casey, IDS.jordan],
    });
    const groupCycle = restarted.createResponsibility(morganCtx, {
      mutationId: randomUUID(),
      title: "Group AT2b",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: restarted.householdDateNow(morganCtx),
        sourceGroupId: group.id,
        savedRingOrder: [IDS.avery, IDS.casey, IDS.jordan],
      },
      steps: [requiredStep("Dishes")],
    });
    const gToday = restarted.householdDateNow(morganCtx);
    const gTomorrow = addDays(gToday, 1);
    const gTodayOcc = restarted
      .materializeForDate(morganCtx, gToday)
      .find((o) => o.definitionId === groupCycle.id)!;
    const gTomorrowOcc = restarted
      .materializeForDate(morganCtx, gTomorrow)
      .find((o) => o.definitionId === groupCycle.id)!;
    const startedOwner = gTodayOcc.accountableMemberId!;
    const ownerGrants2 = (
      restartedDb
        .prepare(`SELECT grant_name FROM membership_grants WHERE membership_id = ?`)
        .all(startedOwner) as Array<{ grant_name: string }>
    ).map((row) => row.grant_name);
    restarted.setStepStatus(
      {
        sessionId: randomUUID(),
        userId: randomUUID(),
        householdId: morganCtx.householdId,
        membershipId: startedOwner,
        displayName: "Owner",
        grants: ownerGrants2 as typeof morganCtx.grants,
        timezone: morganCtx.timezone,
        csrfSecret: "test",
      },
      gTodayOcc.id,
      gTodayOcc.steps[0]!.id,
      {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 1,
        kind: "responsibility",
        intendedStructure: {
          revisionId: gTodayOcc.revisionId,
          accountableMemberId: startedOwner,
          stepLogicalIds: gTodayOcc.steps.map((s) => s.logicalItemId!),
        },
      },
    );
    const groupBefore = restarted.getGroup(morganCtx.householdId, group.id);
    restarted.updateGroup(morganCtx, group.id, {
      name: groupBefore.name,
      membershipIds: [IDS.casey],
      expectedVersion: groupBefore.version,
    });
    const afterToday = restarted
      .materializeForDate(morganCtx, gToday)
      .find((o) => o.definitionId === groupCycle.id)!;
    expect(afterToday.id).toBe(gTodayOcc.id);
    expect(afterToday.accountableMemberId).toBe(startedOwner);
    const afterTomorrow = restarted
      .materializeForDate(morganCtx, gTomorrow)
      .find((o) => o.definitionId === groupCycle.id)!;
    expect(afterTomorrow.id).toBe(gTomorrowOcc.id);
    expect(afterTomorrow.accountableMemberId).toBe(IDS.casey);
    restartedDb.close();
  });

  it("AT10b: first-action vs revise/group/End both orders; injectable plan/group rollback", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.at10b.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.casey,
      "direct_personalizer",
      `casey.at10b.${Date.now().toString(36)}`,
      "Casey Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      `jordan.at10b.${Date.now().toString(36)}`,
      "Jordan Reed",
    );

    const today = store.householdDateNow(manager.context);
    const tomorrow = addDays(today, 1);

    // --- Complete then revise assignment ---
    {
      const kitchen = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Kitchen race A",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: today,
          fixedMemberId: IDS.avery,
        },
        steps: [requiredStep("Counters"), requiredStep("Sink")],
      });
      const occ = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === kitchen.id)!;
      const tomorrowOcc = store
        .materializeForDate(manager.context, tomorrow)
        .find((o) => o.definitionId === kitchen.id)!;
      store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
        kind: "responsibility",
        intendedStructure: {
          revisionId: occ.revisionId,
          accountableMemberId: IDS.avery,
          stepLogicalIds: occ.steps.map((s) => s.logicalItemId!),
        },
      });
      const cur = store.getResponsibilityById(manager.context.householdId, kitchen.id);
      store.createResponsibilityRevision(manager.context, kitchen.id, {
        mutationId: randomUUID(),
        title: "Kitchen race A",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: today,
          fixedMemberId: IDS.casey,
        },
        steps: [requiredStep("Counters"), requiredStep("Sink")],
        expectedVersion: cur.version,
        mode: "current",
      });
      const started = store.getOccurrenceById(occ.id)!;
      expect(started.startedAt).toBeTruthy();
      expect(started.accountableMemberId).toBe(IDS.avery);
      expect(started.steps.map((s) => s.text)).toEqual(["Counters", "Sink"]);
      const future = store
        .materializeForDate(manager.context, tomorrow)
        .find((o) => o.definitionId === kitchen.id)!;
      expect(future.id).toBe(tomorrowOcc.id);
      expect(future.accountableMemberId).toBe(IDS.casey);
    }

    // --- Revise then Complete with OLD intendedStructure ---
    {
      const kitchen = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Kitchen race B",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: today,
          fixedMemberId: IDS.avery,
        },
        steps: [requiredStep("Base A"), requiredStep("Base B")],
      });
      const occ = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === kitchen.id)!;
      const oldIntent = {
        revisionId: occ.revisionId,
        accountableMemberId: IDS.avery,
        stepLogicalIds: occ.steps.map((s) => s.logicalItemId!),
      };
      const cur = store.getResponsibilityById(manager.context.householdId, kitchen.id);
      store.createResponsibilityRevision(manager.context, kitchen.id, {
        mutationId: randomUUID(),
        title: "Kitchen race B",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: today,
          fixedMemberId: IDS.casey,
        },
        steps: [requiredStep("Base A"), requiredStep("Base B"), requiredStep("Extra")],
        expectedVersion: cur.version,
        mode: "current",
      });
      const refreshed = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === kitchen.id)!;
      expect(refreshed.accountableMemberId).toBe(IDS.casey);
      expect(refreshed.steps).toHaveLength(3);
      expect(() =>
        store.setStepStatus(avery.context, refreshed.id, refreshed.steps[0]!.id, {
          mutationId: randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: 0,
          kind: "responsibility",
          intendedStructure: oldIntent,
        }),
      ).toThrow(/changed|structure|intent|stale|refresh|accountable|forbidden|another member/i);
      const still = store.getOccurrenceById(refreshed.id)!;
      expect(still.accountableMemberId).toBe(IDS.casey);
      expect(still.steps).toHaveLength(3);
      expect(still.startedAt).toBeNull();
    }

    // --- First action vs updateGroup (both orders) ---
    {
      const group = store.createGroup(manager.context, {
        mutationId: randomUUID(),
        name: `Race group A ${Date.now().toString(36)}`,
        membershipIds: [IDS.avery, IDS.casey],
      });
      const ring = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Group race A",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "take_turns",
          anchorDate: today,
          sourceGroupId: group.id,
          savedRingOrder: [IDS.avery, IDS.casey],
        },
        steps: [requiredStep("Dishes")],
      });
      const occ = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === ring.id)!;
      expect(occ.accountableMemberId).toBe(IDS.avery);
      store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
        kind: "responsibility",
        intendedStructure: {
          revisionId: occ.revisionId,
          accountableMemberId: IDS.avery,
          stepLogicalIds: occ.steps.map((s) => s.logicalItemId!),
        },
      });
      const g = store.getGroup(manager.context.householdId, group.id);
      store.updateGroup(manager.context, group.id, {
        name: g.name,
        membershipIds: [IDS.casey],
        expectedVersion: g.version,
      });
      expect(store.getOccurrenceById(occ.id)!.accountableMemberId).toBe(IDS.avery);
      const future = store
        .materializeForDate(manager.context, tomorrow)
        .find((o) => o.definitionId === ring.id)!;
      expect(future.accountableMemberId).toBe(IDS.casey);
    }
    {
      const group = store.createGroup(manager.context, {
        mutationId: randomUUID(),
        name: `Race group B ${Date.now().toString(36)}`,
        membershipIds: [IDS.avery, IDS.casey],
      });
      const ring = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Group race B",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "take_turns",
          anchorDate: today,
          sourceGroupId: group.id,
          savedRingOrder: [IDS.avery, IDS.casey],
        },
        steps: [requiredStep("Dishes")],
      });
      const occ = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === ring.id)!;
      const oldIntent = {
        revisionId: occ.revisionId,
        accountableMemberId: occ.accountableMemberId!,
        stepLogicalIds: occ.steps.map((s) => s.logicalItemId!),
      };
      const g = store.getGroup(manager.context.householdId, group.id);
      store.updateGroup(manager.context, group.id, {
        name: g.name,
        membershipIds: [IDS.casey],
        expectedVersion: g.version,
      });
      // Group membership takes effect next day — today owner may still be Avery until
      // a same-day plan revise. Rematerialize today (still prior group version).
      const todayAfter = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === ring.id)!;
      if (todayAfter.accountableMemberId === IDS.avery) {
        store.setStepStatus(avery.context, todayAfter.id, todayAfter.steps[0]!.id, {
          mutationId: randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: 0,
          kind: "responsibility",
          intendedStructure: {
            revisionId: todayAfter.revisionId,
            accountableMemberId: IDS.avery,
            stepLogicalIds: todayAfter.steps.map((s) => s.logicalItemId!),
          },
        });
        expect(store.getOccurrenceById(todayAfter.id)!.startedAt).toBeTruthy();
      } else {
        expect(() =>
          store.setStepStatus(avery.context, todayAfter.id, todayAfter.steps[0]!.id, {
            mutationId: randomUUID(),
            status: "completed",
            performedAt: new Date().toISOString(),
            activityGeneration: 0,
            kind: "responsibility",
            intendedStructure: oldIntent,
          }),
        ).toThrow(/changed|structure|intent|stale|accountable|forbidden/i);
      }
      const future = store
        .materializeForDate(manager.context, tomorrow)
        .find((o) => o.definitionId === ring.id)!;
      expect(future.accountableMemberId).toBe(IDS.casey);
    }

    // --- First action vs endResponsibility (both orders) — started survives End ---
    {
      const kitchen = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "End race A",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: { mode: "fixed", anchorDate: today, fixedMemberId: IDS.avery },
        steps: [requiredStep("Wipe")],
      });
      const occ = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === kitchen.id)!;
      store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
        kind: "responsibility",
        intendedStructure: {
          revisionId: occ.revisionId,
          accountableMemberId: IDS.avery,
          stepLogicalIds: occ.steps.map((s) => s.logicalItemId!),
        },
      });
      const cur = store.getResponsibilityById(manager.context.householdId, kitchen.id);
      store.endResponsibility(manager.context, kitchen.id, {
        mutationId: randomUUID(),
        expectedVersion: cur.version,
      });
      const survivor = store.getOccurrenceById(occ.id)!;
      expect(survivor.startedAt).toBeTruthy();
      expect(survivor.accountableMemberId).toBe(IDS.avery);
    }
    {
      const kitchen = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "End race B",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: { mode: "fixed", anchorDate: today, fixedMemberId: IDS.avery },
        steps: [requiredStep("Wipe")],
      });
      const occ = store
        .materializeForDate(manager.context, today)
        .find((o) => o.definitionId === kitchen.id)!;
      const cur = store.getResponsibilityById(manager.context.householdId, kitchen.id);
      store.endResponsibility(manager.context, kitchen.id, {
        mutationId: randomUUID(),
        expectedVersion: cur.version,
      });
      // Unstarted after End cannot complete; start first then End already covered above.
      // Ordering B: End first cancels unstarted — Complete rejected.
      expect(() =>
        store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
          mutationId: randomUUID(),
          status: "completed",
          performedAt: new Date().toISOString(),
          activityGeneration: 0,
          kind: "responsibility",
          intendedStructure: {
            revisionId: occ.revisionId,
            accountableMemberId: IDS.avery,
            stepLogicalIds: occ.steps.map((s) => s.logicalItemId!),
          },
        }),
      ).toThrow(/canceled|available|forbidden|ended/i);
    }

    // --- Injectable plan rollback ---
    {
      const kitchen = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Rollback Kitchen",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: { mode: "fixed", anchorDate: today, fixedMemberId: IDS.avery },
        steps: [requiredStep("Counters")],
      });
      store.materializeForDate(manager.context, today);
      store.materializeForDate(manager.context, tomorrow);
      const before = dbCounts(db);
      const ownersBefore = (
        db
          .prepare(
            `SELECT household_date, accountable_member_id FROM occurrences
             WHERE definition_id = ? ORDER BY household_date`,
          )
          .all(kitchen.id) as Array<{ household_date: string; accountable_member_id: string }>
      ).map((r) => ({ ...r }));
      const cur = store.getResponsibilityById(manager.context.householdId, kitchen.id);
      store.setResponsibilityPlanFailureHook(() => {
        throw Object.assign(new Error("injected plan failure"), { code: "INTERNAL" });
      });
      try {
        expect(() =>
          store.createResponsibilityRevision(manager.context, kitchen.id, {
            mutationId: randomUUID(),
            title: "Rollback Kitchen",
            daypart: "anytime",
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            assignment: { mode: "fixed", anchorDate: today, fixedMemberId: IDS.casey },
            steps: [requiredStep("Counters"), requiredStep("Extra")],
            expectedVersion: cur.version,
            mode: "current",
          }),
        ).toThrow(/injected plan failure/i);
      } finally {
        store.setResponsibilityPlanFailureHook(null);
      }
      expect(dbCounts(db)).toEqual(before);
      const ownersAfter = db
        .prepare(
          `SELECT household_date, accountable_member_id FROM occurrences
           WHERE definition_id = ? ORDER BY household_date`,
        )
        .all(kitchen.id) as Array<{ household_date: string; accountable_member_id: string }>;
      expect(ownersAfter).toEqual(ownersBefore);
      expect(
        store.getResponsibilityById(manager.context.householdId, kitchen.id).version,
      ).toBe(cur.version);
    }

    // --- Injectable group rollback ---
    {
      const group = store.createGroup(manager.context, {
        mutationId: randomUUID(),
        name: `Rollback group ${Date.now().toString(36)}`,
        membershipIds: [IDS.avery, IDS.casey, IDS.jordan],
      });
      const ring = store.createResponsibility(manager.context, {
        mutationId: randomUUID(),
        title: "Rollback ring",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "take_turns",
          anchorDate: today,
          sourceGroupId: group.id,
          savedRingOrder: [IDS.avery, IDS.casey, IDS.jordan],
        },
        steps: [requiredStep("Dishes")],
      });
      store.materializeForDate(manager.context, tomorrow);
      const groupBefore = store.getGroup(manager.context.householdId, group.id);
      const ownersBefore = (
        db
          .prepare(
            `SELECT household_date, accountable_member_id FROM occurrences
             WHERE definition_id = ? ORDER BY household_date`,
          )
          .all(ring.id) as Array<{ household_date: string; accountable_member_id: string }>
      ).map((r) => ({ ...r }));
      store.setGroupUpdateFailureHook(() => {
        throw Object.assign(new Error("injected group failure"), { code: "INTERNAL" });
      });
      try {
        expect(() =>
          store.updateGroup(manager.context, group.id, {
            name: groupBefore.name,
            membershipIds: [IDS.casey],
            expectedVersion: groupBefore.version,
          }),
        ).toThrow(/injected group failure/i);
      } finally {
        store.setGroupUpdateFailureHook(null);
      }
      expect(store.getGroup(manager.context.householdId, group.id).version).toBe(
        groupBefore.version,
      );
      const ownersAfter = db
        .prepare(
          `SELECT household_date, accountable_member_id FROM occurrences
           WHERE definition_id = ? ORDER BY household_date`,
        )
        .all(ring.id) as Array<{ household_date: string; accountable_member_id: string }>;
      expect(ownersAfter).toEqual(ownersBefore);
    }
  });

  it("AT13: History retains composed headings/Unassigned after rule change; clear keeps anchors", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.at13.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    await enrollAndClaim(
      store,
      manager.context,
      IDS.casey,
      "direct_personalizer",
      `casey.at13.${Date.now().toString(36)}`,
      "Casey Reed",
    );

    const today = store.householdDateNow(manager.context);
    let saturday = today;
    while (isoWeekday(saturday) !== 6) {
      saturday = addDays(saturday, -1);
    }

    const kitchen = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Kitchen History",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "weekly",
        anchorDate: saturday,
        weeklyMap: {
          1: IDS.avery,
          2: IDS.casey,
          3: IDS.avery,
          4: IDS.casey,
          5: IDS.avery,
          6: IDS.avery,
          7: IDS.casey,
        },
      },
      steps: [requiredStep("Counters"), requiredStep("Dishes")],
      scheduledAdditions: [
        {
          name: "Deep Clean",
          weekdays: [6],
          inheritAssignment: false,
          assignment: {
            mode: "take_turns",
            anchorDate: saturday,
            cycleOrder: [IDS.avery, IDS.casey],
          },
          steps: [requiredStep("Oven"), requiredStep("Fridge")],
        },
      ],
    });
    db.prepare(`UPDATE routine_revisions SET effective_date = ? WHERE definition_id = ?`).run(
      saturday,
      kitchen.id,
    );
    db.prepare(`UPDATE routine_schedule_entries SET start_date = ? WHERE definition_id = ?`).run(
      saturday,
      kitchen.id,
    );

    const satOcc = store
      .materializeForDate(manager.context, saturday)
      .find((o) => o.definitionId === kitchen.id)!;
    expect(satOcc.accountableMemberId).toBe(IDS.avery);
    expect(satOcc.steps.map((s) => s.text)).toEqual([
      "Counters",
      "Dishes",
      "Oven",
      "Fridge",
    ]);
    const headingsBefore = (
      db
        .prepare(
          `SELECT text, addition_heading FROM occurrence_steps
           WHERE occurrence_id = ? ORDER BY position`,
        )
        .all(satOcc.id) as Array<{ text: string; addition_heading: string | null }>
    ).map((r) => ({ text: r.text, heading: r.addition_heading }));
    expect(headingsBefore.some((h) => h.heading === "Deep Clean")).toBe(true);

    store.setStepStatus(avery.context, satOcc.id, satOcc.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: 0,
      kind: "responsibility",
      intendedStructure: {
        revisionId: satOcc.revisionId,
        accountableMemberId: IDS.avery,
        stepLogicalIds: satOcc.steps.map((s) => s.logicalItemId!),
      },
    });
    const detailBefore = store.getHistoryOccurrenceDetail(manager.context, satOcc.id);
    expect(detailBefore.accountableMemberId).toBe(IDS.avery);
    expect(detailBefore.steps.map((s) => s.text)).toContain("Oven");

    const cur = store.getResponsibilityById(manager.context.householdId, kitchen.id);
    store.createResponsibilityRevision(manager.context, kitchen.id, {
      mutationId: randomUUID(),
      title: "Kitchen History",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "fixed",
        anchorDate: today,
        fixedMemberId: IDS.casey,
      },
      steps: [requiredStep("Counters")],
      scheduledAdditions: [],
      expectedVersion: cur.version,
      mode: "current",
    });

    const detailAfter = store.getHistoryOccurrenceDetail(manager.context, satOcc.id);
    expect(detailAfter.accountableMemberId).toBe(IDS.avery);
    expect(detailAfter.steps.map((s) => s.text)).toEqual([
      "Counters",
      "Dishes",
      "Oven",
      "Fridge",
    ]);
    const headingsAfter = (
      db
        .prepare(
          `SELECT text, addition_heading FROM occurrence_steps
           WHERE occurrence_id = ? ORDER BY position`,
        )
        .all(satOcc.id) as Array<{ text: string; addition_heading: string | null }>
    ).map((r) => ({ text: r.text, heading: r.addition_heading }));
    expect(headingsAfter).toEqual(headingsBefore);

    const historyDay = store.historyForDate(manager.context, saturday);
    expect(historyDay.some((o) => o.id === satOcc.id)).toBe(true);

    // Unassigned occurrence retained in History grouping.
    const emptyGroup = store.createGroup(manager.context, {
      mutationId: randomUUID(),
      name: `Empty AT13 ${Date.now().toString(36)}`,
      membershipIds: [IDS.avery, IDS.casey],
    });
    const unassigned = store.createResponsibility(manager.context, {
      mutationId: randomUUID(),
      title: "Unassigned AT13",
      daypart: "anytime",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assignment: {
        mode: "take_turns",
        anchorDate: today,
        sourceGroupId: emptyGroup.id,
        savedRingOrder: [IDS.avery, IDS.casey],
        excludedMemberIds: [IDS.avery, IDS.casey],
      },
      steps: [requiredStep("Feed")],
    });
    const unOcc = store
      .materializeForDate(manager.context, today)
      .find((o) => o.definitionId === unassigned.id)!;
    expect(unOcc.accountableMemberId).toBeNull();
    const histToday = store.historyForDate(manager.context, today);
    const unHist = histToday.find((o) => o.id === unOcc.id);
    expect(unHist).toBeTruthy();
    expect(unHist!.accountableMemberId).toBeNull();
    expect(unHist!.accountableMemberName).toMatch(/Unassigned/i);
    const unDetail = store.getHistoryOccurrenceDetail(manager.context, unOcc.id);
    expect(unDetail.accountableMemberName).toMatch(/Unassigned/i);

    // Clear keeps plan anchors; rematerialize matches original phase.
    const planBefore = (
      db
        .prepare(
          `SELECT rrp.revision_id, rrp.assignment_json
           FROM revision_responsibility_plans rrp
           JOIN routine_revisions rr ON rr.id = rrp.revision_id
           WHERE rr.definition_id = ?
           ORDER BY rr.effective_date, rrp.revision_id`,
        )
        .all(kitchen.id) as Array<{ revision_id: string; assignment_json: string }>
    ).map((r) => ({ revisionId: r.revision_id, assignment: JSON.parse(r.assignment_json) }));
    expect(planBefore.length).toBeGreaterThan(0);
    const originalPhase = store
      .previewResponsibilityNextDays(manager.context, kitchen.id, 7)
      .filter((d) => d.applicable)
      .map((d) => ({ date: d.householdDate, owner: d.accountableMemberId }));

    store.clearRoutineActivity(manager.context, {
      mutationId: randomUUID(),
      expectedGeneration: 0,
      acknowledgedScope: "routines_and_responsibilities",
    });
    const planAfter = (
      db
        .prepare(
          `SELECT rrp.revision_id, rrp.assignment_json
           FROM revision_responsibility_plans rrp
           JOIN routine_revisions rr ON rr.id = rrp.revision_id
           WHERE rr.definition_id = ?
           ORDER BY rr.effective_date, rrp.revision_id`,
        )
        .all(kitchen.id) as Array<{ revision_id: string; assignment_json: string }>
    ).map((r) => ({ revisionId: r.revision_id, assignment: JSON.parse(r.assignment_json) }));
    expect(planAfter).toEqual(planBefore);

    const rematerializedPhase = store
      .previewResponsibilityNextDays(manager.context, kitchen.id, 7)
      .filter((d) => d.applicable)
      .map((d) => ({ date: d.householdDate, owner: d.accountableMemberId }));
    expect(rematerializedPhase).toEqual(originalPhase);
  });

  it("AT14: preview-draft auth; foreign household; plan-reference cleanup blocker", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const manager = await httpClaimManager(harness);
      const enrollAvery = await harness.app.inject({
        method: "POST",
        url: "/api/v1/enrollment/claims",
        headers: authHeaders(harness, manager),
        payload: {
          mutationId: randomUUID(),
          membershipId: IDS.avery,
          preset: "direct_personalizer",
        },
      });
      expect(enrollAvery.statusCode).toBe(200);
      const averyToken = (enrollAvery.json() as { claim: { token: string } }).claim.token;
      const averyClaim = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: harness.origin },
        payload: {
          claimToken: averyToken,
          loginName: `avery.at14.${Date.now().toString(36)}`,
          passphrase: "unique-passphrase-ok!",
          displayName: "Avery Reed",
        },
      });
      expect(averyClaim.statusCode).toBe(200);
      const averySession = sessionFromResponse(harness, averyClaim);

      const draftPayload = {
        mutationId: randomUUID(),
        title: "Draft AT14",
        daypart: "anytime",
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        assignment: {
          mode: "fixed",
          anchorDate: "2026-09-01",
          fixedMemberId: IDS.avery,
        },
        steps: [{ text: "Wipe", obligation: "required" }],
      };

      // Structure-only: strip responsibility.manage
      harness.db.prepare("DELETE FROM membership_grants WHERE membership_id = ?").run(IDS.morgan);
      for (const grant of [
        "household.member.enroll",
        "household.structure.manage",
        "household.activity.clear",
        "personal_task.create",
      ]) {
        harness.db
          .prepare("INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)")
          .run(IDS.morgan, grant);
      }
      const structureCreate = await harness.app.inject({
        method: "POST",
        url: "/api/v1/responsibilities",
        headers: authHeaders(harness, manager),
        payload: draftPayload,
      });
      expect(structureCreate.statusCode).toBe(403);
      const structurePreview = await harness.app.inject({
        method: "POST",
        url: "/api/v1/responsibilities/preview-draft",
        headers: authHeaders(harness, manager),
        payload: { ...draftPayload, mutationId: randomUUID() },
      });
      expect(structurePreview.statusCode).toBe(403);

      // Restore responsibility.manage
      harness.db
        .prepare("INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)")
        .run(IDS.morgan, "responsibility.manage");
      const manageCreate = await harness.app.inject({
        method: "POST",
        url: "/api/v1/responsibilities",
        headers: authHeaders(harness, manager),
        payload: { ...draftPayload, mutationId: randomUUID() },
      });
      expect(manageCreate.statusCode).toBe(200);
      const managePreview = await harness.app.inject({
        method: "POST",
        url: "/api/v1/responsibilities/preview-draft",
        headers: authHeaders(harness, manager),
        payload: { ...draftPayload, mutationId: randomUUID() },
      });
      expect(managePreview.statusCode).toBe(200);

      // Executor without manage cannot preview-draft
      const execPreview = await harness.app.inject({
        method: "POST",
        url: "/api/v1/responsibilities/preview-draft",
        headers: authHeaders(harness, averySession),
        payload: { ...draftPayload, mutationId: randomUUID() },
      });
      expect(execPreview.statusCode).toBe(403);

      // Foreign household isolation (store-level)
      const foreignHousehold = randomUUID();
      const foreignMembership = randomUUID();
      harness.db
        .prepare(
          `INSERT INTO households (id, name, timezone) VALUES (?, 'Foreign', 'America/New_York')`,
        )
        .run(foreignHousehold);
      harness.db
        .prepare(
          `INSERT INTO household_memberships
           (id, household_id, user_id, display_name, status, created_at, sort_order)
           VALUES (?, ?, NULL, 'Foreign Manager', 'active', ?, 0)`,
        )
        .run(foreignMembership, foreignHousehold, new Date().toISOString());
      harness.db
        .prepare(
          `INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)`,
        )
        .run(foreignMembership, "responsibility.manage");
      const foreignCtx = {
        sessionId: randomUUID(),
        userId: randomUUID(),
        householdId: foreignHousehold,
        membershipId: foreignMembership,
        displayName: "Foreign Manager",
        grants: ["responsibility.manage"] as typeof manager extends never
          ? never
          : Awaited<ReturnType<typeof claimManager>>["context"]["grants"],
        timezone: "America/New_York",
        csrfSecret: "test",
      };
      const localId = (manageCreate.json() as { responsibility: { id: string } }).responsibility
        .id;
      expect(() =>
        harness.store.createResponsibilityRevision(foreignCtx, localId, {
          mutationId: randomUUID(),
          title: "Hack",
          daypart: "anytime",
          weekdays: [1],
          accountableMemberId: foreignMembership,
          steps: [{ text: "X", obligation: "required" }],
          expectedVersion: 1,
          mode: "current",
        }),
      ).toThrow(/not found|forbidden/i);

      // Cleanup blocker: membership referenced only via plan JSON
      const orphanId = randomUUID();
      harness.db
        .prepare(
          `INSERT INTO household_memberships
           (id, household_id, user_id, display_name, status, created_at, sort_order)
           VALUES (?, ?, NULL, 'Orphan Plan Ref', 'pending', ?, 99)`,
        )
        .run(orphanId, SEED.household.id, new Date().toISOString());
      const revId = randomUUID();
      const defId = randomUUID();
      harness.db
        .prepare(
          `INSERT INTO routine_definitions
           (id, household_id, version, archived_at, archive_cutoff_date, created_at, kind)
           VALUES (?, ?, 1, NULL, NULL, ?, 'responsibility')`,
        )
        .run(defId, SEED.household.id, new Date().toISOString());
      harness.db
        .prepare(
          `INSERT INTO routine_revisions
           (id, definition_id, effective_date, title, weekdays_json, daypart, created_at)
           VALUES (?, ?, ?, 'Plan Ref', ?, 'anytime', ?)`,
        )
        .run(
          revId,
          defId,
          "2026-09-01",
          JSON.stringify([1, 2, 3, 4, 5, 6, 7]),
          new Date().toISOString(),
        );
      harness.db
        .prepare(
          `INSERT INTO revision_responsibility_plans
           (revision_id, assignment_json, scheduled_additions_json)
           VALUES (?, ?, ?)`,
        )
        .run(
          revId,
          JSON.stringify({
            mode: "fixed",
            anchorDate: "2026-09-01",
            fixedMemberId: orphanId,
          }),
          JSON.stringify([]),
        );
      const report = evaluateMembership(harness.db, orphanId, SEED.household.id);
      expect(report.blockers).toContain("has_responsibility_plan_reference");
    } finally {
      await harness.close();
    }
  });
});
