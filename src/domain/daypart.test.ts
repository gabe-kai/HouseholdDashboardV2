import { describe, expect, it } from "vitest";
import {
  compareOccurrenceOrder,
  daypartOrder,
  isBeforeArchiveCutoff,
  isDaypart,
} from "./daypart.js";

describe("daypart", () => {
  it("orders Morning before Anytime", () => {
    expect(daypartOrder("morning")).toBeLessThan(daypartOrder("anytime"));
    expect(
      compareOccurrenceOrder(
        { daypart: "bedtime", definitionId: "b" },
        { daypart: "after_school", definitionId: "a" },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareOccurrenceOrder(
        { daypart: "morning", definitionId: "a" },
        { daypart: "morning", definitionId: "b" },
      ),
    ).toBeLessThan(0);
  });

  it("treats archive cutoff as exclusive", () => {
    expect(isBeforeArchiveCutoff("2026-09-12", "2026-09-13")).toBe(true);
    expect(isBeforeArchiveCutoff("2026-09-13", "2026-09-13")).toBe(false);
    expect(isBeforeArchiveCutoff("2026-09-14", null)).toBe(true);
  });

  it("validates vocabulary", () => {
    expect(isDaypart("morning")).toBe(true);
    expect(isDaypart("Morning")).toBe(false);
  });
});
