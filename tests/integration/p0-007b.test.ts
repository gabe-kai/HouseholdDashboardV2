import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import {
  claimManager,
  enrollAndClaim,
  IDS,
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
    ).toBe(14);

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
    ).toBe(14);

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
});
