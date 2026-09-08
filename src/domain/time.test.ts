import { describe, expect, it } from "vitest";
import { householdDateFromInstant, isoWeekdayForHouseholdDate, addHouseholdDays } from "./time.js";
import { isDateApplicable, selectRevisionForDate } from "./recurrence.js";

describe("household timezone boundaries", () => {
  it("uses household timezone rather than UTC calendar day around midnight", () => {
    // 2024-03-10 04:30 UTC is still 2024-03-09 evening in America/New_York
    const before = householdDateFromInstant("2024-03-10T04:30:00.000Z", "America/New_York");
    const after = householdDateFromInstant("2024-03-10T05:00:00.000Z", "America/New_York");
    expect(before).toBe("2024-03-09");
    expect(after).toBe("2024-03-10");
  });

  it("handles a spring-forward DST transition without skipping/duplicating the local date", () => {
    // US DST spring forward 2024-03-10 in America/New_York
    const eveningBefore = householdDateFromInstant("2024-03-10T04:30:00.000Z", "America/New_York");
    const morningAfter = householdDateFromInstant("2024-03-10T08:00:00.000Z", "America/New_York");
    expect(eveningBefore).toBe("2024-03-09");
    expect(morningAfter).toBe("2024-03-10");
    expect(addHouseholdDays(eveningBefore, 1)).toBe("2024-03-10");
  });

  it("selects applicable revision by household-local date and weekday", () => {
    const revisions = [
      { id: "a", effectiveDate: "2026-09-01", weekdays: [1, 2, 3, 4, 5] },
      { id: "b", effectiveDate: "2026-09-08", weekdays: [1, 2, 3, 4, 5] },
    ];
    expect(selectRevisionForDate(revisions, "2026-09-07")?.id).toBe("a");
    expect(selectRevisionForDate(revisions, "2026-09-08")?.id).toBe("b");
    // 2026-09-06 is Sunday
    expect(isoWeekdayForHouseholdDate("2026-09-06")).toBe(7);
    expect(isDateApplicable("2026-09-06", [1, 2, 3, 4, 5])).toBe(false);
    expect(isDateApplicable("2026-09-07", [1, 2, 3, 4, 5])).toBe(true);
  });
});
