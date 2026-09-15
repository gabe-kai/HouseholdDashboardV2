import { describe, expect, it } from "vitest";
import {
  activeScheduleEntries,
  enumerateAffectedDates,
  governedRangeEndExclusive,
  isDateInGovernedRange,
  selectScheduleEntryForDate,
} from "./plan.js";

const entryA = {
  id: "a",
  startDate: "2026-09-14",
  revisionId: "rev-a",
};

const entryB = {
  id: "b",
  startDate: "2026-09-16",
  revisionId: "rev-b",
};

describe("plan", () => {
  it("selects A for Sep 14/15 and B for Sep 16", () => {
    const entries = [entryA, entryB];
    expect(selectScheduleEntryForDate(entries, "2026-09-14")?.id).toBe("a");
    expect(selectScheduleEntryForDate(entries, "2026-09-15")?.id).toBe("a");
    expect(selectScheduleEntryForDate(entries, "2026-09-16")?.id).toBe("b");
  });

  it("governed range from Sep 14 with B at Sep 16 includes 14 and known 15, excludes 16", () => {
    const endExclusive = governedRangeEndExclusive("2026-09-14", [entryA, entryB]);
    expect(endExclusive).toBe("2026-09-16");
    expect(isDateInGovernedRange("2026-09-14", "2026-09-14", endExclusive)).toBe(true);
    expect(isDateInGovernedRange("2026-09-15", "2026-09-14", endExclusive)).toBe(true);
    expect(isDateInGovernedRange("2026-09-16", "2026-09-14", endExclusive)).toBe(false);
    expect(
      enumerateAffectedDates("2026-09-14", endExclusive, ["2026-09-15", "2026-09-16"]),
    ).toEqual(["2026-09-14", "2026-09-15"]);
  });

  it("ignores canceled schedule entries", () => {
    const canceledB = { ...entryB, canceledAt: "2026-09-13T12:00:00.000Z" };
    const entries = [entryA, canceledB];
    expect(activeScheduleEntries(entries).map((e) => e.id)).toEqual(["a"]);
    expect(selectScheduleEntryForDate(entries, "2026-09-16")?.id).toBe("a");
    expect(governedRangeEndExclusive("2026-09-14", entries)).toBeNull();
  });

  it("open-ended range includes known future dates", () => {
    const endExclusive = governedRangeEndExclusive("2026-09-14", [entryA]);
    expect(endExclusive).toBeNull();
    expect(
      enumerateAffectedDates("2026-09-14", null, ["2026-09-20", "2026-09-10"]),
    ).toEqual(["2026-09-14", "2026-09-20"]);
  });
});
