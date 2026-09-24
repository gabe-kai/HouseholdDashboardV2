import { afterEach, describe, expect, it } from "vitest";
import type { Daypart } from "./daypart.js";
import {
  projectPersonalDay,
  type ProjectableOccurrence,
  type ProjectablePersonalTask,
} from "./today-projection.js";

function occ(
  partial: Partial<ProjectableOccurrence> &
    Pick<ProjectableOccurrence, "id" | "definitionId" | "daypart">,
): ProjectableOccurrence {
  return {
    completed: false,
    startedAt: null,
    steps: [{ status: "open" }],
    ...partial,
  };
}

function task(
  partial: Partial<ProjectablePersonalTask> &
    Pick<ProjectablePersonalTask, "id" | "createdAt">,
): ProjectablePersonalTask {
  return {
    status: "open",
    ...partial,
  };
}

describe("projectPersonalDay", () => {
  afterEach(() => {
    // Projection must not depend on process timezone; restore after probes.
    if (process.env.TZ !== undefined) {
      delete process.env.TZ;
    }
  });

  it("projects mixed kinds across dayparts with continuation preference", () => {
    const morningDone = occ({
      id: "occ-morning",
      definitionId: "def-morning",
      daypart: "morning",
      kind: "routine",
      completed: true,
      startedAt: "2026-09-24T11:00:00.000Z",
      steps: [{ status: "completed" }],
      title: "Morning",
    });
    const afterSchool = occ({
      id: "occ-after",
      definitionId: "def-after",
      daypart: "after_school",
      kind: "routine",
      steps: [
        { status: "completed" },
        { status: "open" },
        { status: "open" },
        { status: "open" },
        { status: "open" },
      ],
      startedAt: "2026-09-24T15:00:00.000Z",
      title: "After School",
    });
    const kitchen = occ({
      id: "occ-kitchen",
      definitionId: "def-kitchen",
      daypart: "evening",
      kind: "responsibility",
      title: "Kitchen",
    });
    const bedtime = occ({
      id: "occ-bed",
      definitionId: "def-bed",
      daypart: "bedtime",
      kind: "routine",
      title: "Bedtime",
    });
    const anytime = occ({
      id: "occ-any",
      definitionId: "def-any",
      daypart: "anytime",
      kind: "routine",
      title: "Anytime chore",
    });
    const openTask = task({
      id: "task-1",
      createdAt: "2026-09-24T10:00:00.000Z",
      status: "open",
    });

    // Intentionally reverse/network-ish input order; kind must not win.
    const projection = projectPersonalDay(
      [bedtime, anytime, kitchen, morningDone, afterSchool],
      [openTask],
    );

    expect(projection.completed.map((o) => o.id)).toEqual(["occ-morning"]);
    expect(projection.next?.id).toBe("occ-after");
    expect(projection.later.map((o) => o.id)).toEqual([
      "occ-kitchen",
      "occ-bed",
    ]);
    expect(projection.anytimeOccurrences.map((o) => o.id)).toEqual(["occ-any"]);
    expect(projection.openPersonalTasks.map((t) => t.id)).toEqual(["task-1"]);
    expect(projection.recommendedFocusId).toBe("occ-after");
  });

  it("prefers in-progress over earlier daypart that is not started", () => {
    const morningOpen = occ({
      id: "m",
      definitionId: "def-m",
      daypart: "morning",
      kind: "responsibility",
    });
    const eveningStarted = occ({
      id: "e",
      definitionId: "def-e",
      daypart: "evening",
      kind: "routine",
      startedAt: "2026-09-24T18:00:00.000Z",
      steps: [{ status: "open" }],
    });

    const projection = projectPersonalDay([morningOpen, eveningStarted], []);
    expect(projection.next?.id).toBe("e");
    expect(projection.later.map((o) => o.id)).toEqual(["m"]);
  });

  it("breaks ties by definitionId then occurrence id; kind never wins", () => {
    const a = occ({
      id: "occ-b",
      definitionId: "def-a",
      daypart: "morning",
      kind: "responsibility",
    });
    const b = occ({
      id: "occ-a",
      definitionId: "def-a",
      daypart: "morning",
      kind: "routine",
    });
    const c = occ({
      id: "occ-c",
      definitionId: "def-b",
      daypart: "morning",
      kind: "routine",
    });

    const projection = projectPersonalDay([c, a, b], []);
    expect(projection.next?.id).toBe("occ-a");
    expect(projection.later.map((o) => o.id)).toEqual(["occ-b", "occ-c"]);
  });

  it("uses first anytime occurrence for focus when there is no scheduled next", () => {
    const anyA = occ({
      id: "any-b",
      definitionId: "def-any-a",
      daypart: "anytime",
    });
    const anyB = occ({
      id: "any-a",
      definitionId: "def-any-a",
      daypart: "anytime",
    });
    const openTask = task({
      id: "task-focus",
      createdAt: "2026-09-01T00:00:00.000Z",
    });

    const projection = projectPersonalDay([anyA, anyB], [openTask]);
    expect(projection.next).toBeNull();
    expect(projection.later).toEqual([]);
    expect(projection.anytimeOccurrences.map((o) => o.id)).toEqual([
      "any-a",
      "any-b",
    ]);
    expect(projection.recommendedFocusId).toBe("any-a");
    expect(projection.recommendedFocusId).not.toBe("task-focus");
  });

  it("places all completed work in completed and leaves focus null when nothing unfinished", () => {
    const done1 = occ({
      id: "d1",
      definitionId: "a",
      daypart: "morning",
      completed: true,
      steps: [{ status: "completed" }],
    });
    const done2 = occ({
      id: "d2",
      definitionId: "b",
      daypart: "anytime",
      completed: true,
      steps: [{ status: "completed" }],
    });
    const doneTask = task({
      id: "t-done",
      createdAt: "2026-09-20T00:00:00.000Z",
      status: "completed",
    });

    const projection = projectPersonalDay([done2, done1], [doneTask]);
    expect(projection.next).toBeNull();
    expect(projection.later).toEqual([]);
    expect(projection.anytimeOccurrences).toEqual([]);
    expect(projection.completed.map((o) => o.id)).toEqual(["d1", "d2"]);
    expect(projection.completedPersonalTasks.map((t) => t.id)).toEqual([
      "t-done",
    ]);
    expect(projection.openPersonalTasks).toEqual([]);
    expect(projection.recommendedFocusId).toBeNull();
  });

  it("returns empty sections and null focus for empty inputs (no invented all-done message)", () => {
    const projection = projectPersonalDay([], []);
    expect(projection).toEqual({
      completed: [],
      next: null,
      later: [],
      anytimeOccurrences: [],
      openPersonalTasks: [],
      completedPersonalTasks: [],
      recommendedFocusId: null,
    });
  });

  it("is independent of input response order", () => {
    const items: ProjectableOccurrence[] = [
      occ({ id: "3", definitionId: "c", daypart: "bedtime" }),
      occ({ id: "1", definitionId: "a", daypart: "morning" }),
      occ({ id: "2", definitionId: "b", daypart: "evening" }),
    ];
    const forward = projectPersonalDay(items, []);
    const reverse = projectPersonalDay([...items].reverse(), []);
    expect(forward.next?.id).toBe(reverse.next?.id);
    expect(forward.later.map((o) => o.id)).toEqual(
      reverse.later.map((o) => o.id),
    );
  });

  it("sorts personal tasks by createdAt ASC then id ASC (not network DESC)", () => {
    const tasks = [
      task({ id: "z", createdAt: "2026-09-24T12:00:00.000Z" }),
      task({ id: "a", createdAt: "2026-09-24T10:00:00.000Z" }),
      task({ id: "b", createdAt: "2026-09-24T10:00:00.000Z" }),
      task({
        id: "old-done",
        createdAt: "2026-09-01T00:00:00.000Z",
        status: "completed",
      }),
    ];
    const projection = projectPersonalDay([], tasks);
    expect(projection.openPersonalTasks.map((t) => t.id)).toEqual([
      "a",
      "b",
      "z",
    ]);
    expect(projection.completedPersonalTasks.map((t) => t.id)).toEqual([
      "old-done",
    ]);
  });

  it("does not use Date.now or browser timezone for classification", () => {
    const householdDated = occ({
      id: "dated",
      definitionId: "def",
      daypart: "morning" as Daypart,
      // Household date lives on the occurrence from the server; projection
      // never consults local clock to decide Next/Later/Anytime.
    });

    process.env.TZ = "Pacific/Kiritimati";
    const east = projectPersonalDay([householdDated], []);
    process.env.TZ = "America/Los_Angeles";
    const west = projectPersonalDay([householdDated], []);

    expect(east.next?.id).toBe("dated");
    expect(west.next?.id).toBe("dated");
    expect(east.recommendedFocusId).toBe(west.recommendedFocusId);
  });

  it("treats step touch without startedAt as in-progress for Next preference", () => {
    const laterDaypartTouched = occ({
      id: "touched",
      definitionId: "def-t",
      daypart: "bedtime",
      startedAt: null,
      steps: [{ status: "completed" }, { status: "open" }],
    });
    const earlierOpen = occ({
      id: "earlier",
      definitionId: "def-e",
      daypart: "morning",
    });

    const projection = projectPersonalDay(
      [earlierOpen, laterDaypartTouched],
      [],
    );
    expect(projection.next?.id).toBe("touched");
  });
});
