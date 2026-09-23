import { describe, expect, it } from "vitest";
import {
  buildGroupBackedRing,
  opportunityIndexForDate,
  resolveAssignmentOwner,
} from "./responsibility-assignment.js";

describe("responsibility assignment oracle", () => {
  const alwaysEligible = () => true;
  const emptyRing = () => [];

  it("fixed mode returns member when eligible", () => {
    const result = resolveAssignmentOwner(
      "2026-09-01",
      [1, 2, 3, 4, 5, 6, 7],
      {
        mode: "fixed",
        anchorDate: "2026-09-01",
        fixedMemberId: "member-a",
      },
      emptyRing,
      alwaysEligible,
    );
    expect(result.accountableMemberId).toBe("member-a");
  });

  it("take turns advances deterministically across skipped weekdays", () => {
    const spec = {
      mode: "take_turns" as const,
      anchorDate: "2026-09-07",
      cycleOrder: ["a", "b", "c"],
    };
    const mon = resolveAssignmentOwner("2026-09-07", [1, 3, 5], spec, emptyRing, alwaysEligible);
    const wed = resolveAssignmentOwner("2026-09-09", [1, 3, 5], spec, emptyRing, alwaysEligible);
    const fri = resolveAssignmentOwner("2026-09-11", [1, 3, 5], spec, emptyRing, alwaysEligible);
    expect(mon.accountableMemberId).toBe("a");
    expect(wed.accountableMemberId).toBe("b");
    expect(fri.accountableMemberId).toBe("c");
  });

  it("weekly pattern maps ISO weekday to member", () => {
    const result = resolveAssignmentOwner(
      "2026-09-05",
      [1, 2, 3, 4, 5, 6, 7],
      {
        mode: "weekly",
        anchorDate: "2026-09-01",
        weeklyMap: { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 7: "sun" },
      },
      emptyRing,
      alwaysEligible,
    );
    expect(result.accountableMemberId).toBe("sat");
  });

  it("empty cycle ring resolves Unassigned", () => {
    const result = resolveAssignmentOwner(
      "2026-09-01",
      [1, 2, 3, 4, 5, 6, 7],
      { mode: "take_turns", anchorDate: "2026-09-01", cycleOrder: [] },
      emptyRing,
      alwaysEligible,
    );
    expect(result.accountableMemberId).toBeNull();
    expect(result.unassignedReason).toMatch(/eligible/i);
  });

  it("group-backed ring preserves ranked returnees and appends entrants", () => {
    const ring = buildGroupBackedRing(
      "2026-09-10",
      ["b", "a"],
      ["a", "c", "b"],
      (id) => (id === "c" ? "2026-09-05" : "2026-09-01"),
    );
    expect(ring).toEqual(["b", "a", "c"]);
  });

  it("opportunity index is zero-based from anchor", () => {
    expect(opportunityIndexForDate("2026-09-01", "2026-09-01", [1, 2, 3, 4, 5])).toBe(0);
    expect(opportunityIndexForDate("2026-09-01", "2026-09-02", [1, 2, 3, 4, 5])).toBe(1);
  });
});
