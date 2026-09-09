import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays, householdDateFromInstant } from "../../src/domain/time.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import {
  IDS,
  claimManager,
  enrollAndClaim,
  tempDbPath,
} from "../helpers/auth-fixture.js";

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

function freshStore(timezone = "America/New_York") {
  const dbPath = tempDbPath("hd-p1");
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed(timezone);
  return { db, store, timezone };
}

function weekdayOf(date: string): number {
  const [y, m, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y!, m! - 1, day!, 12));
  const wd = utc.getUTCDay();
  return wd === 0 ? 7 : wd;
}

describe("P0-001 regression under authenticated authority", () => {
  it("materializes distinct occurrences without duplicates under repeated reads", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const today = store.householdDateNow(manager.context);
    const weekday = weekdayOf(today);

    store.createRoutine(manager.context, {
      title: "Morning Routine",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      weekdays: [weekday],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    });

    const first = store.materializeForDate(manager.context, today);
    const second = store.materializeForDate(manager.context, today);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(new Set(first.map((o) => o.id)).size).toBe(2);
    expect(first.map((o) => o.id).sort()).toEqual(second.map((o) => o.id).sort());
    expect(first[0]!.steps).toHaveLength(3);
  });

  it("keeps assignment/execution facts separate, idempotent mutations, and forbids cross-member writes", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      "avery.p1",
      "Avery Reed",
    );
    const jordan = await enrollAndClaim(
      store,
      manager.context,
      IDS.jordan,
      "direct_personalizer",
      "jordan.p1",
      "Jordan Reed",
    );
    const today = store.householdDateNow(manager.context);
    const weekday = weekdayOf(today);

    store.createRoutine(manager.context, {
      title: "Morning Routine",
      assigneeMemberIds: [IDS.avery, IDS.jordan],
      weekdays: [weekday],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    });

    const averyOcc = store.materializeForDate(avery.context, today)[0]!;
    const jordanOcc = store.materializeForDate(jordan.context, today)[0]!;
    const step = averyOcc.steps[0]!;
    const mutationId = "33333333-3333-4333-8333-333333333301";

    const first = store.setStepStatus(avery.context, averyOcc.id, step.id, {
      mutationId,
      status: "completed",
      performedAt: "2026-09-06T12:00:00.000Z",
    });
    const replay = store.setStepStatus(avery.context, averyOcc.id, step.id, {
      mutationId,
      status: "completed",
      performedAt: "2026-09-06T12:00:00.000Z",
    });

    expect(first.report.actingMemberId).toBe(avery.context.membershipId);
    expect(first.report.accountableMemberId).toBe(averyOcc.accountableMemberId);
    expect(first.report.performedAt).toBe("2026-09-06T12:00:00.000Z");
    expect(first.report.recordedAt).toMatch(/Z$/);
    expect(first.report.mutationId).toBe(mutationId);
    expect(store.countStepReports(mutationId)).toBe(1);
    expect(replay.occurrence.version).toBe(first.occurrence.version);

    expect(() =>
      store.setStepStatus(jordan.context, averyOcc.id, step.id, {
        mutationId: "33333333-3333-4333-8333-333333333302",
        status: "completed",
        performedAt: "2026-09-06T12:01:00.000Z",
      }),
    ).toThrow(/another member/i);

    expect(() =>
      store.setStepStatus(manager.context, jordanOcc.id, jordanOcc.steps[0]!.id, {
        mutationId: "33333333-3333-4333-8333-333333333303",
        status: "completed",
        performedAt: "2026-09-06T12:01:00.000Z",
      }),
    ).toThrow(/another member/i);
  });

  it("preserves today's snapshot after a future-effective revision", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const avery = await enrollAndClaim(
      store,
      manager.context,
      IDS.avery,
      "direct_personalizer",
      "avery.hist",
      "Avery Reed",
    );
    const today = store.householdDateNow(manager.context);
    const weekday = weekdayOf(today);
    const tomorrowWeekday = weekdayOf(addHouseholdDays(today, 1));

    store.createRoutine(manager.context, {
      title: "Morning Routine",
      assigneeMemberIds: [IDS.avery],
      weekdays: [weekday, tomorrowWeekday],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    });

    const todayOcc = store.materializeForDate(avery.context, today)[0]!;
    store.setStepStatus(avery.context, todayOcc.id, todayOcc.steps[0]!.id, {
      mutationId: "33333333-3333-4333-8333-333333333311",
      status: "completed",
      performedAt: "2026-09-06T12:00:00.000Z",
    });
    store.setStepStatus(avery.context, todayOcc.id, todayOcc.steps[1]!.id, {
      mutationId: "33333333-3333-4333-8333-333333333312",
      status: "not_needed",
      performedAt: "2026-09-06T12:01:00.000Z",
    });

    const before = store.occurrenceSnapshotStructure(todayOcc.id);
    const routine = store.getRoutine(manager.context.householdId)!;
    store.createRevision(manager.context, routine.id, {
      title: "Morning Routine v2",
      assigneeMemberIds: [IDS.avery],
      weekdays: [weekday, tomorrowWeekday],
      steps: [
        { text: "Brush teeth", obligation: "required" },
        { text: "Make bed", obligation: "optional" },
        { text: "Pack lunch", obligation: "required" },
      ],
    });

    expect(store.occurrenceSnapshotStructure(todayOcc.id)).toEqual(before);

    const tomorrowOcc = store.materializeForDate(avery.context, addHouseholdDays(today, 1))[0]!;
    expect(tomorrowOcc.title).toBe("Morning Routine v2");
    expect(tomorrowOcc.steps.map((s) => s.text)).toEqual([
      "Brush teeth",
      "Make bed",
      "Pack lunch",
    ]);
    expect(tomorrowOcc.steps.map((s) => s.obligation)).toEqual([
      "required",
      "optional",
      "required",
    ]);
  });

  it("resolves household dates with a device timezone different from household timezone", () => {
    const householdTz = "Pacific/Auckland";
    expect(householdDateFromInstant("2026-09-06T10:00:00.000Z", householdTz)).toBe("2026-09-06");
    expect(householdDateFromInstant("2026-09-05T11:30:00.000Z", householdTz)).toBe("2026-09-05");
  });
});
