import { describe, expect, it } from "vitest";
import {
  buildHouseholdOverview,
  routineDisplayTitle,
  type OverviewOccurrence,
} from "./household-overview.js";
import type { Daypart } from "./daypart.js";

function occ(
  partial: Partial<OverviewOccurrence> &
    Pick<
      OverviewOccurrence,
      "id" | "definitionId" | "householdDate" | "daypart" | "title"
    >,
): OverviewOccurrence {
  return {
    accountableMemberId: "member-1",
    accountableMemberName: "Alex",
    completed: false,
    startedAt: null,
    steps: [{ status: "open", obligation: "required" }],
    kind: "routine",
    ...partial,
  };
}

describe("routineDisplayTitle", () => {
  it("uses one title, sorted pair join, or Multiple titles", () => {
    expect(routineDisplayTitle(["Kitchen"])).toBe("Kitchen");
    expect(routineDisplayTitle(["Beta", "Alpha"])).toBe("Alpha / Beta");
    expect(routineDisplayTitle(["C", "A", "B"])).toBe("Multiple titles");
  });
});

describe("buildHouseholdOverview", () => {
  it("keeps one row per responsibility including Unassigned", () => {
    const kitchen = occ({
      id: "resp-kitchen",
      definitionId: "def-kitchen",
      householdDate: "2026-09-24",
      daypart: "evening",
      title: "Kitchen",
      kind: "responsibility",
      accountableMemberId: "m-sarah",
      accountableMemberName: "Sarah",
      steps: [
        { status: "completed", obligation: "required" },
        { status: "open", obligation: "required" },
        { status: "open", obligation: "required" },
        { status: "open", obligation: "required" },
        { status: "open", obligation: "required" },
      ],
      startedAt: "2026-09-24T18:00:00.000Z",
    });
    const unassigned = occ({
      id: "resp-trash",
      definitionId: "def-trash",
      householdDate: "2026-09-24",
      daypart: "morning",
      title: "Trash",
      kind: "responsibility",
      accountableMemberId: null,
      accountableMemberName: "",
    });

    const overview = buildHouseholdOverview([kitchen, unassigned]);
    expect(overview.responsibilities.map((r) => r.id)).toEqual([
      "resp-trash",
      "resp-kitchen",
    ]);
    expect(overview.responsibilities[0]).toMatchObject({
      title: "Trash",
      accountableMemberId: null,
      accountableMemberName: "Unassigned",
      state: "Not started",
    });
    expect(overview.responsibilities[1]).toMatchObject({
      title: "Kitchen",
      accountableMemberName: "Sarah",
      state: "In progress",
      progressLabel: "1/5 done",
    });
  });

  it("aggregates routines by definitionId::householdDate, not by title", () => {
    const morningA = occ({
      id: "r1",
      definitionId: "def-morning-a",
      householdDate: "2026-09-24",
      daypart: "morning",
      title: "Morning",
      accountableMemberId: "m1",
      accountableMemberName: "Eli",
      completed: true,
      steps: [{ status: "completed", obligation: "required" }],
    });
    const morningB = occ({
      id: "r2",
      definitionId: "def-morning-b",
      householdDate: "2026-09-24",
      daypart: "morning",
      title: "Morning",
      accountableMemberId: "m2",
      accountableMemberName: "Daniel",
    });

    const overview = buildHouseholdOverview([morningB, morningA]);
    expect(overview.routines).toHaveLength(2);
    expect(overview.routines.map((r) => r.key)).toEqual([
      "def-morning-a::2026-09-24",
      "def-morning-b::2026-09-24",
    ]);
    expect(overview.routines[0]?.applicableCount).toBe(1);
    expect(overview.routines[0]?.completedCount).toBe(1);
    expect(overview.routines[0]?.overallState).toBe("Complete");
    expect(overview.routines[1]?.overallState).toBe("Not started");
  });

  it("uses deterministic mixed-title labels inside one aggregate", () => {
    const shared = {
      definitionId: "def-shared",
      householdDate: "2026-09-24",
      daypart: "morning" as Daypart,
      kind: "routine" as const,
    };
    const overview = buildHouseholdOverview([
      occ({
        ...shared,
        id: "p1",
        title: "Morning v2",
        accountableMemberId: "m1",
        accountableMemberName: "Eli",
        startedAt: "2026-09-24T08:00:00.000Z",
        steps: [
          { status: "completed", obligation: "required" },
          { status: "open", obligation: "required" },
        ],
      }),
      occ({
        ...shared,
        id: "p2",
        title: "Morning",
        accountableMemberId: "m2",
        accountableMemberName: "Daniel",
      }),
      occ({
        ...shared,
        id: "p3",
        title: "Morning Special",
        accountableMemberId: "m3",
        accountableMemberName: "Sam",
      }),
    ]);

    expect(overview.routines).toHaveLength(1);
    expect(overview.routines[0]?.displayTitle).toBe("Multiple titles");
    expect(overview.routines[0]?.applicableCount).toBe(3);
    expect(overview.routines[0]?.completedCount).toBe(0);
    expect(overview.routines[0]?.overallState).toBe("In progress");

    const twoTitle = buildHouseholdOverview([
      occ({
        ...shared,
        id: "a",
        title: "Zebra",
        accountableMemberId: "m1",
      }),
      occ({
        ...shared,
        id: "b",
        title: "Apple",
        accountableMemberId: "m2",
      }),
    ]);
    expect(twoTitle.routines[0]?.displayTitle).toBe("Apple / Zebra");
  });

  it("omits empty aggregates and treats missing kind as routine", () => {
    const overview = buildHouseholdOverview([
      {
        id: "legacy",
        definitionId: "def-legacy",
        householdDate: "2026-09-24",
        daypart: "after_school",
        title: "Legacy",
        // kind omitted → routine
        accountableMemberId: "m1",
        accountableMemberName: "Alex",
        completed: false,
        startedAt: null,
        steps: [{ status: "open" }],
      },
    ]);
    expect(overview.responsibilities).toEqual([]);
    expect(overview.routines).toHaveLength(1);
    expect(overview.routines[0]?.key).toBe("def-legacy::2026-09-24");
  });

  it("keeps person counts distinct from step counts", () => {
    const overview = buildHouseholdOverview([
      occ({
        id: "p1",
        definitionId: "def-r",
        householdDate: "2026-09-24",
        daypart: "morning",
        title: "Routine",
        accountableMemberId: "m1",
        accountableMemberName: "Eli",
        completed: true,
        steps: [
          { status: "completed", obligation: "required" },
          { status: "completed", obligation: "required" },
          { status: "completed", obligation: "required" },
          { status: "open", obligation: "optional" },
        ],
      }),
      occ({
        id: "p2",
        definitionId: "def-r",
        householdDate: "2026-09-24",
        daypart: "morning",
        title: "Routine",
        accountableMemberId: "m2",
        accountableMemberName: "Daniel",
        completed: false,
        steps: [
          { status: "open", obligation: "required" },
          { status: "open", obligation: "required" },
          { status: "open", obligation: "required" },
          { status: "open", obligation: "required" },
          { status: "open", obligation: "required" },
        ],
      }),
    ]);

    const row = overview.routines[0]!;
    expect(row.applicableCount).toBe(2);
    expect(row.completedCount).toBe(1);
    // Step progress on a person is not the aggregate denominator.
    expect(row.people[0]?.progress.total).toBe(4);
    expect(row.people[1]?.progress.total).toBe(5);
    expect(row.applicableCount).not.toBe(row.people[0]!.progress.total);
  });

  it("marks pending from options without inventing rows", () => {
    const overview = buildHouseholdOverview(
      [
        occ({
          id: "pending-occ",
          definitionId: "def-r",
          householdDate: "2026-09-24",
          daypart: "morning",
          title: "Routine",
          accountableMemberId: "m1",
        }),
        occ({
          id: "resp-pending",
          definitionId: "def-resp",
          householdDate: "2026-09-24",
          daypart: "evening",
          title: "Cats",
          kind: "responsibility",
          accountableMemberId: "m2",
          accountableMemberName: "Sam",
        }),
      ],
      { pendingOccurrenceIds: new Set(["pending-occ", "resp-pending"]) },
    );

    expect(overview.routines[0]?.pending).toBe(true);
    expect(overview.routines[0]?.people[0]?.pending).toBe(true);
    expect(overview.responsibilities[0]?.pending).toBe(true);
  });

  it("sorts routine aggregates by daypart then definitionId", () => {
    const overview = buildHouseholdOverview([
      occ({
        id: "evening-b",
        definitionId: "def-b",
        householdDate: "2026-09-24",
        daypart: "evening",
        title: "B",
      }),
      occ({
        id: "morning-z",
        definitionId: "def-z",
        householdDate: "2026-09-24",
        daypart: "morning",
        title: "Z",
      }),
      occ({
        id: "morning-a",
        definitionId: "def-a",
        householdDate: "2026-09-24",
        daypart: "morning",
        title: "A",
      }),
    ]);

    expect(overview.routines.map((r) => r.definitionId)).toEqual([
      "def-a",
      "def-z",
      "def-b",
    ]);
  });

  it("does not create a zero-person 0/0 row", () => {
    // Only responsibilities → routines list stays empty (no phantom aggregate).
    const overview = buildHouseholdOverview([
      occ({
        id: "only-resp",
        definitionId: "def-r",
        householdDate: "2026-09-24",
        daypart: "evening",
        title: "Kitchen",
        kind: "responsibility",
      }),
    ]);
    expect(overview.routines).toEqual([]);
    expect(overview.responsibilities).toHaveLength(1);
  });
});
