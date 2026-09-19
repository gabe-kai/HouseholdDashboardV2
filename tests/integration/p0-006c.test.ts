import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays } from "../../src/domain/time.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import {
  authHeaders,
  claimManager,
  createHttpHarness,
  enrollAndClaim,
  httpClaimManager,
  IDS,
} from "../helpers/auth-fixture.js";
import { openPopulatedP009UpgradeDatabase, P009_FIXTURE_IDS } from "../helpers/p009-fixture.js";

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
    `hd-006c-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { store, db, dbPath };
}

describe("P0-006C profiles, history, and activity clear", () => {
  it("AT1: through-009 fixture upgrades with profile defaults, order, generation zero, clear grant", () => {
    const dbPath = path.join(os.tmpdir(), `hd-006c-p009-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openPopulatedP009UpgradeDatabase(dbPath);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '010_%'")
          .get() as { c: number }
      ).c,
    ).toBe(0);

    migrate(db);

    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM schema_migrations WHERE id LIKE '010_%'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            `SELECT full_name, birthday, email FROM household_memberships WHERE id = ?`,
          )
          .get(P009_FIXTURE_IDS.morganId) as {
          full_name: string | null;
          birthday: string | null;
          email: string | null;
        }
      ),
    ).toEqual({ full_name: null, birthday: null, email: null });
    expect(
      (
        db
          .prepare(`SELECT activity_generation FROM households WHERE id = ?`)
          .get(P009_FIXTURE_IDS.householdId) as { activity_generation: number }
      ).activity_generation,
    ).toBe(0);
    expect(
      (
        db
          .prepare(
            `SELECT 1 AS ok FROM membership_grants
             WHERE membership_id = ? AND grant_name = 'household.activity.clear'`,
          )
          .get(P009_FIXTURE_IDS.morganId) as { ok: number } | undefined
      )?.ok,
    ).toBe(1);
    const orders = db
      .prepare(
        `SELECT id, sort_order FROM household_memberships
         WHERE household_id = ? ORDER BY sort_order, id`,
      )
      .all(P009_FIXTURE_IDS.householdId) as Array<{ id: string; sort_order: number }>;
    expect(orders.map((row) => row.sort_order)).toEqual(orders.map((_, index) => index));
    expect((db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length).toBe(0);
    migrate(db);
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c,
    ).toBe(12);
  });

  it("AT2/AT3: profile update validation and structure grant", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const updated = store.updatePerson(manager.context, IDS.avery, {
      displayName: "Ave",
      classification: "child",
      fullName: "Avery Reed",
      birthday: "2014-05-01",
      email: "avery@example.test",
      expectedVersion: 1,
    });
    expect(updated.displayName).toBe("Ave");
    expect(store.getPersonDetail(manager.context, IDS.avery).fullName).toBe("Avery Reed");
    expect(store.getPersonDetail(manager.context, IDS.avery).birthday).toBe("2014-05-01");

    expect(() =>
      store.updatePerson(manager.context, IDS.avery, {
        displayName: "Ave",
        classification: "child",
        birthday: "2099-01-01",
        expectedVersion: updated.version,
      }),
    ).toThrow(/Birthday/i);

    expect(() =>
      store.updatePerson(manager.context, IDS.avery, {
        displayName: "Ave",
        classification: "child",
        expectedVersion: 1,
      }),
    ).toThrow(/version|elsewhere|conflict/i);

    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.006c.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    expect(() =>
      store.updatePerson(avery.context, IDS.morgan, {
        displayName: "Hack",
        classification: "adult",
        expectedVersion: 1,
      }),
    ).toThrow(/authority|grant|forbidden|permission|structure|manage/i);
  });

  it("AT4/AT5: family order save, replay, and injectable rollback", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const people = store.listMemberships(manager.context.householdId);
    const reversed = [...people].reverse().map((person) => person.id);
    const version = store.getFamilyOrderVersion(manager.context.householdId);
    const mutationId = randomUUID();
    const saved = store.saveFamilyOrder(manager.context, {
      mutationId,
      expectedVersion: version,
      membershipIds: reversed,
    });
    expect(saved.people.map((person) => person.id)).toEqual(reversed);
    expect(store.getFamilyOrderVersion(manager.context.householdId)).toBe(version + 1);

    const replay = store.saveFamilyOrder(manager.context, {
      mutationId,
      expectedVersion: version,
      membershipIds: reversed,
    });
    expect(replay).toEqual(saved);

    expect(() =>
      store.saveFamilyOrder(manager.context, {
        mutationId: randomUUID(),
        expectedVersion: version + 1,
        membershipIds: reversed.slice(1),
      }),
    ).toThrow(/missing|every|membership|person/i);

    const beforeVersion = store.getFamilyOrderVersion(manager.context.householdId);
    const beforeOrders = db
      .prepare(
        `SELECT id, sort_order FROM household_memberships WHERE household_id = ? ORDER BY id`,
      )
      .all(manager.context.householdId);
    store.setFamilyOrderFailureHook(() => {
      throw Object.assign(new Error("injected family order failure"), { code: "INTERNAL" });
    });
    try {
      expect(() =>
        store.saveFamilyOrder(manager.context, {
          mutationId: randomUUID(),
          expectedVersion: beforeVersion,
          membershipIds: people.map((person) => person.id),
        }),
      ).toThrow(/injected family order failure/i);
    } finally {
      store.setFamilyOrderFailureHook(null);
    }
    expect(store.getFamilyOrderVersion(manager.context.householdId)).toBe(beforeVersion);
    expect(
      db
        .prepare(
          `SELECT id, sort_order FROM household_memberships WHERE household_id = ? ORDER BY id`,
        )
        .all(manager.context.householdId),
    ).toEqual(beforeOrders);
  });

  it("AT6: History reads never write for past or today", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.hist.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "History Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [{ text: "Brush", obligation: "required" }],
    });
    const today = store.householdDateNow(manager.context);
    store.materializeForDate(manager.context, today);
    const before = (
      db.prepare(`SELECT COUNT(*) AS c FROM occurrences`).get() as { c: number }
    ).c;
    const beforeSteps = (
      db.prepare(`SELECT COUNT(*) AS c FROM occurrence_steps`).get() as { c: number }
    ).c;
    const summaries = store.historySummaries(manager.context, { date: today });
    expect(summaries.occurrences.length).toBeGreaterThan(0);
    store.historyForDate(manager.context, today);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM occurrences`).get() as { c: number }).c,
    ).toBe(before);
    expect(
      (db.prepare(`SELECT COUNT(*) AS c FROM occurrence_steps`).get() as { c: number }).c,
    ).toBe(beforeSteps);
    expect(() => store.historySummaries(manager.context, { date: "2099-01-01" })).toThrow(
      /Preview|future/i,
    );
  });

  it("AT7: honest complete/incomplete counts and evidence detail", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.ev.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Evidence Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [
        { text: "Required", obligation: "required" },
        { text: "Optional", obligation: "optional" },
        { text: "As needed", obligation: "as_needed" },
      ],
    });
    const today = store.householdDateNow(manager.context);
    const occ = store
      .materializeForDate(manager.context, today)
      .find((row) => row.definitionId === routine.id)!;
    store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: 0,
    });
    store.setStepStatus(avery.context, occ.id, occ.steps[2]!.id, {
      mutationId: randomUUID(),
      status: "not_needed",
      performedAt: new Date().toISOString(),
      activityGeneration: 0,
    });
    const detail = store.getHistoryOccurrenceDetail(manager.context, occ.id);
    expect(detail.reports.length).toBe(2);
    const summary = store
      .historySummaries(manager.context, { date: today })
      .occurrences.find((row) => row.id === occ.id)!;
    expect(summary.counts.completed).toBe(1);
    expect(summary.counts.notNeeded).toBe(1);
    expect(summary.completed).toBe(true);
  });

  it("AT9/AT10/AT11/AT12: clear retention, atomic rollback, rematerialize, generation fence", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      `avery.clear.${Date.now().toString(36)}`,
      "Avery Reed",
    );
    const routine = store.createRoutine(manager.context, {
      mutationId: randomUUID(),
      title: "Clear Morning",
      daypart: "morning",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      assigneeMemberIds: [IDS.avery],
      assigneeGroupIds: [],
      steps: [{ text: "Pack", obligation: "required" }],
    });
    const today = store.householdDateNow(manager.context);
    const occ = store
      .materializeForDate(manager.context, today)
      .find((row) => row.definitionId === routine.id)!;
    store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
      mutationId: randomUUID(),
      status: "completed",
      performedAt: new Date().toISOString(),
      activityGeneration: 0,
    });

    const peopleBefore = store.listMemberships(manager.context.householdId).length;
    const routinesBefore = store.listRoutines(manager.context.householdId).length;
    const calendarBefore = store.getSchoolCalendar(manager.context);
    const beforeOcc = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM occurrences WHERE household_id = ?`)
        .get(manager.context.householdId) as { c: number }
    ).c;
    expect(beforeOcc).toBeGreaterThan(0);

    store.setClearActivityFailureHook(() => {
      throw Object.assign(new Error("injected clear failure"), { code: "INTERNAL" });
    });
    try {
      expect(() =>
        store.clearRoutineActivity(manager.context, {
          mutationId: randomUUID(),
          expectedGeneration: 0,
        }),
      ).toThrow(/injected clear failure/i);
    } finally {
      store.setClearActivityFailureHook(null);
    }
    expect(store.getActivityGeneration(manager.context.householdId)).toBe(0);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM occurrences WHERE household_id = ?`)
          .get(manager.context.householdId) as { c: number }
      ).c,
    ).toBe(beforeOcc);

    const clearMutation = randomUUID();
    const cleared = store.clearRoutineActivity(manager.context, {
      mutationId: clearMutation,
      expectedGeneration: 0,
    });
    expect(cleared.activityGeneration).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM occurrences WHERE household_id = ?`)
          .get(manager.context.householdId) as { c: number }
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM mutation_receipts WHERE household_id = ?`)
          .get(manager.context.householdId) as { c: number }
      ).c,
    ).toBe(0);
    expect(store.listMemberships(manager.context.householdId).length).toBe(peopleBefore);
    expect(store.listRoutines(manager.context.householdId).length).toBe(routinesBefore);
    expect(store.getSchoolCalendar(manager.context)).toEqual(calendarBefore);

    const replay = store.clearRoutineActivity(manager.context, {
      mutationId: clearMutation,
      expectedGeneration: 0,
    });
    expect(replay).toEqual(cleared);

    const rematerialized = store.materializeForDate(manager.context, today);
    const fresh = rematerialized.find((row) => row.definitionId === routine.id);
    expect(fresh?.id).not.toBe(occ.id);
    expect(fresh?.startedAt).toBeNull();

    expect(() =>
      store.setStepStatus(avery.context, occ.id, occ.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
      }),
    ).toThrow(/cleared|not found/i);

    expect(() =>
      store.setStepStatus(avery.context, fresh!.id, fresh!.steps[0]!.id, {
        mutationId: randomUUID(),
        status: "completed",
        performedAt: new Date().toISOString(),
        activityGeneration: 0,
      }),
    ).toThrow(/cleared/i);

    const yesterday = addHouseholdDays(today, -1);
    expect(store.materializeForDate(manager.context, yesterday)).toEqual([]);
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM occurrences
             WHERE household_id = ? AND household_date = ?`,
          )
          .get(manager.context.householdId, yesterday) as { c: number }
      ).c,
    ).toBe(0);
  });

  it("AT9 HTTP: clear respects config gate when disabled", async () => {
    const harness = await createHttpHarness({ ALLOW_EVALUATION_HISTORY_CLEAR: "0" });
    temps.push(harness.dbPath);
    const manager = await httpClaimManager(harness);
    const denied = await harness.app.inject({
      method: "POST",
      url: "/api/v1/household/activity/clear",
      headers: authHeaders(harness, manager),
      payload: { mutationId: randomUUID(), expectedGeneration: 0 },
    });
    expect(denied.statusCode).toBe(403);
  });
});
