import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import { addHouseholdDays, householdDateFromInstant } from "../../src/domain/time.js";

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
  const dbPath = path.join(os.tmpdir(), `hd-int-${Date.now()}-${Math.random()}.sqlite`);
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed(timezone);
  return { db, store, timezone };
}

describe("P0-001 integration", () => {
  it("materializes distinct occurrences without duplicates under repeated reads", () => {
    const { store } = freshStore();
    const parent = store.createSession("22222222-2222-4222-8222-222222222201");
    const today = store.householdDateNow(parent);
    // Ensure today is a weekday in the routine
    const weekday = ((d: string) => {
      const [y, m, day] = d.split("-").map(Number);
      const utc = new Date(Date.UTC(y, m - 1, day, 12));
      const wd = utc.getUTCDay();
      return wd === 0 ? 7 : wd;
    })(today);

    store.createRoutine(parent, {
      title: "Morning Routine",
      assigneeMemberIds: [
        "22222222-2222-4222-8222-222222222202",
        "22222222-2222-4222-8222-222222222203",
      ],
      weekdays: [weekday],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    });

    const first = store.materializeForDate(parent, today);
    const second = store.materializeForDate(parent, today);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(new Set(first.map((o) => o.id)).size).toBe(2);
    expect(first.map((o) => o.id).sort()).toEqual(second.map((o) => o.id).sort());
    expect(first[0].steps).toHaveLength(3);
  });

  it("keeps assignment/execution facts separate, idempotent mutations, and forbids cross-child writes", () => {
    const { store, db } = freshStore();
    const parent = store.createSession("22222222-2222-4222-8222-222222222201");
    const today = store.householdDateNow(parent);
    const weekday = ((d: string) => {
      const [y, m, day] = d.split("-").map(Number);
      const utc = new Date(Date.UTC(y, m - 1, day, 12));
      const wd = utc.getUTCDay();
      return wd === 0 ? 7 : wd;
    })(today);

    store.createRoutine(parent, {
      title: "Morning Routine",
      assigneeMemberIds: [
        "22222222-2222-4222-8222-222222222202",
        "22222222-2222-4222-8222-222222222203",
      ],
      weekdays: [weekday],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    });

    const jamie = store.createSession("22222222-2222-4222-8222-222222222202");
    const riley = store.createSession("22222222-2222-4222-8222-222222222203");
    const jamieOcc = store.materializeForDate(jamie, today)[0];
    const rileyOcc = store.materializeForDate(riley, today)[0];
    const step = jamieOcc.steps[0];
    const mutationId = "33333333-3333-4333-8333-333333333301";

    const first = store.setStepStatus(jamie, jamieOcc.id, step.id, {
      mutationId,
      status: "completed",
      performedAt: "2026-09-06T12:00:00.000Z",
    });
    const replay = store.setStepStatus(jamie, jamieOcc.id, step.id, {
      mutationId,
      status: "completed",
      performedAt: "2026-09-06T12:00:00.000Z",
    });

    expect(first.report.actingMemberId).toBe(jamie.memberId);
    expect(first.report.accountableMemberId).toBe(jamieOcc.accountableMemberId);
    expect(first.report.performedAt).toBe("2026-09-06T12:00:00.000Z");
    expect(first.report.recordedAt).toMatch(/Z$/);
    expect(first.report.mutationId).toBe(mutationId);
    expect(store.countStepReports(mutationId)).toBe(1);
    expect(replay.occurrence.version).toBe(first.occurrence.version);

    expect(() =>
      store.setStepStatus(riley, jamieOcc.id, step.id, {
        mutationId: "33333333-3333-4333-8333-333333333302",
        status: "completed",
        performedAt: "2026-09-06T12:01:00.000Z",
      }),
    ).toThrow(/another member/i);

    expect(() =>
      store.setStepStatus(parent, rileyOcc.id, rileyOcc.steps[0].id, {
        mutationId: "33333333-3333-4333-8333-333333333303",
        status: "completed",
        performedAt: "2026-09-06T12:01:00.000Z",
      }),
    ).toThrow(/observe/i);

    void db;
  });

  it("preserves today's snapshot after a future-effective revision", () => {
    const { store } = freshStore();
    const parent = store.createSession("22222222-2222-4222-8222-222222222201");
    const today = store.householdDateNow(parent);
    const weekday = ((d: string) => {
      const [y, m, day] = d.split("-").map(Number);
      const utc = new Date(Date.UTC(y, m - 1, day, 12));
      const wd = utc.getUTCDay();
      return wd === 0 ? 7 : wd;
    })(today);
    const tomorrowWeekday = ((d: string) => {
      const [y, m, day] = d.split("-").map(Number);
      const utc = new Date(Date.UTC(y, m - 1, day, 12));
      const wd = utc.getUTCDay();
      return wd === 0 ? 7 : wd;
    })(addHouseholdDays(today, 1));

    store.createRoutine(parent, {
      title: "Morning Routine",
      assigneeMemberIds: ["22222222-2222-4222-8222-222222222202"],
      weekdays: [weekday, tomorrowWeekday],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    });

    const jamie = store.createSession("22222222-2222-4222-8222-222222222202");
    const todayOcc = store.materializeForDate(jamie, today)[0];
    store.setStepStatus(jamie, todayOcc.id, todayOcc.steps[0].id, {
      mutationId: "33333333-3333-4333-8333-333333333311",
      status: "completed",
      performedAt: "2026-09-06T12:00:00.000Z",
    });
    store.setStepStatus(jamie, todayOcc.id, todayOcc.steps[1].id, {
      mutationId: "33333333-3333-4333-8333-333333333312",
      status: "not_needed",
      performedAt: "2026-09-06T12:01:00.000Z",
    });

    const before = store.occurrenceSnapshotStructure(todayOcc.id);
    const routine = store.getRoutine(parent.householdId)!;
    store.createRevision(parent, routine.id, {
      title: "Morning Routine v2",
      assigneeMemberIds: ["22222222-2222-4222-8222-222222222202"],
      weekdays: [weekday, tomorrowWeekday],
      steps: [
        { text: "Brush teeth", obligation: "required" },
        { text: "Make bed", obligation: "optional" },
        { text: "Pack lunch", obligation: "required" },
      ],
    });

    const after = store.occurrenceSnapshotStructure(todayOcc.id);
    expect(after).toEqual(before);

    const tomorrow = addHouseholdDays(today, 1);
    const tomorrowOcc = store.materializeForDate(jamie, tomorrow)[0];
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
    // Device TZ is irrelevant to domain helper — household TZ wins.
    const householdTz = "Pacific/Auckland";
    const date = householdDateFromInstant("2026-09-06T10:00:00.000Z", householdTz);
    expect(date).toBe("2026-09-06");
    const earlier = householdDateFromInstant("2026-09-05T11:30:00.000Z", householdTz);
    expect(earlier).toBe("2026-09-05");
  });
});
