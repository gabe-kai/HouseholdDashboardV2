import { describe, expect, it } from "vitest";
import {
  composeResponsibilityForDate,
  findOwnerSettingOverlap,
} from "./responsibility-composition.js";

describe("responsibility composition", () => {
  const deps = {
    resolveRing: () => ["owner-a", "owner-b"],
    isEligible: () => true,
  };

  it("rejects overlapping owner-setting additions", () => {
    const conflict = findOwnerSettingOverlap([1, 2, 3, 4, 5, 6, 7], [
      {
        id: "a",
        name: "Deep clean",
        weekdays: [6],
        inheritAssignment: false,
        assignment: { mode: "fixed", anchorDate: "2026-09-01", fixedMemberId: "x" },
        steps: [{ logicalItemId: "s1", text: "Scrub", obligation: "required" }],
        position: 0,
      },
      {
        id: "b",
        name: "Other",
        weekdays: [6, 7],
        inheritAssignment: false,
        assignment: { mode: "fixed", anchorDate: "2026-09-01", fixedMemberId: "y" },
        steps: [{ logicalItemId: "s2", text: "Mop", obligation: "required" }],
        position: 1,
      },
    ]);
    expect(conflict?.weekdays).toEqual([6]);
  });

  it("owner-setting addition owns whole composed occurrence", () => {
    const result = composeResponsibilityForDate({
      householdDate: "2026-09-05",
      revisionId: "rev-1",
      parentWeekdays: [1, 2, 3, 4, 5, 6, 7],
      baseSteps: [{ logicalItemId: "b1", text: "Counters", obligation: "required" }],
      baseAssignment: {
        mode: "weekly",
        anchorDate: "2026-09-01",
        weeklyMap: { "1": "a", "2": "a", "3": "a", "4": "a", "5": "a", "6": "a", "7": "a" },
      },
      additions: [
        {
          id: "add-1",
          name: "Deep clean",
          weekdays: [6],
          inheritAssignment: false,
          assignment: {
            mode: "take_turns",
            anchorDate: "2026-09-01",
            cycleOrder: ["casey", "avery"],
          },
          steps: [{ logicalItemId: "d1", text: "Oven", obligation: "required" }],
          position: 0,
        },
      ],
      ...deps,
    });
    expect(result.accountableMemberId).toBe("casey");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]?.additionHeading).toBe("Deep clean");
  });

  it("inherit-only additions compose without changing base owner", () => {
    const result = composeResponsibilityForDate({
      householdDate: "2026-09-06",
      revisionId: "rev-1",
      parentWeekdays: [1, 2, 3, 4, 5, 6, 7],
      baseSteps: [{ logicalItemId: "b1", text: "Sink", obligation: "required" }],
      baseAssignment: {
        mode: "fixed",
        anchorDate: "2026-09-01",
        fixedMemberId: "jordan",
      },
      additions: [
        {
          id: "add-1",
          name: "Sunday extra",
          weekdays: [7],
          inheritAssignment: true,
          steps: [{ logicalItemId: "s1", text: "Towels", obligation: "required" }],
          position: 0,
        },
      ],
      ...deps,
    });
    expect(result.accountableMemberId).toBe("jordan");
    expect(result.steps).toHaveLength(2);
  });
});
