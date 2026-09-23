import { describe, expect, it } from "vitest";
import {
  buildGroupBackedRing,
  opportunityIndexForDate,
  resolveAssignmentOwner,
} from "./responsibility-assignment.js";
import {
  householdDateFromInstant,
  isoWeekdayForHouseholdDate,
} from "./time.js";

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

  it("DST spring-forward household date keeps ISO weekday weekly map", () => {
    // 2024-03-10 America/New_York spring-forward; 08:00Z is still 2024-03-10 locally.
    const nyDate = householdDateFromInstant(
      new Date("2024-03-10T08:00:00.000Z"),
      "America/New_York",
    );
    expect(nyDate).toBe("2024-03-10");
    expect(isoWeekdayForHouseholdDate(nyDate)).toBe(7);
    const weekly = resolveAssignmentOwner(
      nyDate,
      [1, 2, 3, 4, 5, 6, 7],
      {
        mode: "weekly",
        anchorDate: "2024-03-04",
        weeklyMap: {
          1: "mon",
          2: "tue",
          3: "wed",
          4: "thu",
          5: "fri",
          6: "sat",
          7: "sun",
        },
      },
      emptyRing,
      alwaysEligible,
    );
    expect(weekly.accountableMemberId).toBe("sun");
  });

  it("traveling timezone resolves weekday from household-local date, not UTC", () => {
    const instant = new Date("2024-03-10T08:00:00.000Z");
    const laDate = householdDateFromInstant(instant, "America/Los_Angeles");
    const tokyoDate = householdDateFromInstant(instant, "Asia/Tokyo");
    expect(laDate).toBe("2024-03-10");
    expect(tokyoDate).toBe("2024-03-10");
    expect(isoWeekdayForHouseholdDate(laDate)).toBe(7);
    // Same calendar date → same weekly owner regardless of travel TZ.
    const map = {
      mode: "weekly" as const,
      anchorDate: "2024-03-04",
      weeklyMap: {
        1: "mon",
        2: "tue",
        3: "wed",
        4: "thu",
        5: "fri",
        6: "sat",
        7: "sun",
      },
    };
    expect(
      resolveAssignmentOwner(laDate, [1, 2, 3, 4, 5, 6, 7], map, emptyRing, alwaysEligible)
        .accountableMemberId,
    ).toBe("sun");
    expect(
      resolveAssignmentOwner(tokyoDate, [1, 2, 3, 4, 5, 6, 7], map, emptyRing, alwaysEligible)
        .accountableMemberId,
    ).toBe("sun");
  });
});
