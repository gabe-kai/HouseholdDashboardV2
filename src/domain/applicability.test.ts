import { describe, expect, it } from "vitest";
import {
  evaluateApplicability,
  isSchoolDayForDate,
  type ApplicabilityRule,
} from "./applicability.js";
import {
  addHouseholdDays,
  householdDateFromInstant,
  isoWeekdayForHouseholdDate,
} from "./time.js";
import { validateSchoolCalendarDraft } from "./school-calendar.js";

const mondayFriCalendar = {
  years: [
    {
      startDate: "2026-09-01",
      endDate: "2027-06-15",
      usualWeekdays: [1, 2, 3, 4, 5],
      exceptions: [
        { startDate: "2026-12-24", endDate: "2027-01-02" },
        { startDate: "2026-10-12", endDate: "2026-10-12" },
      ],
    },
  ],
};

function ctxFor(date: string) {
  const iso = isoWeekdayForHouseholdDate(date);
  const next = addHouseholdDays(date, 1);
  const nextIso = isoWeekdayForHouseholdDate(next);
  const schoolToday = isSchoolDayForDate(date, mondayFriCalendar, iso);
  const schoolTomorrow = isSchoolDayForDate(next, mondayFriCalendar, nextIso);
  return { date, isoWeekday: iso, nextDate: next, nextIsoWeekday: nextIso, schoolToday, schoolTomorrow };
}

function decide(rule: ApplicabilityRule, date: string) {
  return evaluateApplicability({ rule, ...ctxFor(date) });
}

describe("school day context", () => {
  it("treats unconfigured calendar as unknown", () => {
    expect(isSchoolDayForDate("2026-09-14", null, 1)).toEqual({ status: "unconfigured" });
    expect(isSchoolDayForDate("2026-09-14", { years: [] }, 1)).toEqual({
      status: "unconfigured",
    });
  });

  it("marks weekdays in year as school days and weekends/outside as no-school", () => {
    expect(isSchoolDayForDate("2026-09-14", mondayFriCalendar, 1)).toEqual({
      status: "configured",
      isSchoolDay: true,
    });
    expect(isSchoolDayForDate("2026-09-12", mondayFriCalendar, 6)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2026-07-01", mondayFriCalendar, 3)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
  });

  it("applies inclusive single-date and range exceptions", () => {
    expect(isSchoolDayForDate("2026-10-12", mondayFriCalendar, 1)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2026-12-24", mondayFriCalendar, 4)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2027-01-02", mondayFriCalendar, 6)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2027-01-05", mondayFriCalendar, 2)).toEqual({
      status: "configured",
      isSchoolDay: true,
    });
  });
});

describe("applicability evaluation", () => {
  it("includes every_time always", () => {
    expect(decide({ kind: "every_time" }, "2026-09-14").include).toBe(true);
  });

  it("evaluates school nights from tomorrow", () => {
    // Sunday before Monday school
    expect(decide({ kind: "school_nights" }, "2026-09-13")).toMatchObject({
      include: true,
    });
    // Sunday before Monday holiday (2026-10-12 is exception)
    expect(decide({ kind: "school_nights" }, "2026-10-11")).toMatchObject({
      include: false,
    });
  });

  it("supports unusual Saturday school day making Friday a school night", () => {
    const satSchool = {
      years: [
        {
          startDate: "2026-09-01",
          endDate: "2027-06-15",
          usualWeekdays: [1, 2, 3, 4, 5, 6],
          exceptions: [],
        },
      ],
    };
    const friday = "2026-09-18";
    const next = addHouseholdDays(friday, 1);
    const result = evaluateApplicability({
      rule: { kind: "school_nights" },
      date: friday,
      isoWeekday: isoWeekdayForHouseholdDate(friday),
      nextDate: next,
      nextIsoWeekday: isoWeekdayForHouseholdDate(next),
      schoolToday: isSchoolDayForDate(friday, satSchool, isoWeekdayForHouseholdDate(friday)),
      schoolTomorrow: isSchoolDayForDate(next, satSchool, isoWeekdayForHouseholdDate(next)),
    });
    expect(result.include).toBe(true);
  });

  it("reports unresolved school context when calendar missing", () => {
    const date = "2026-09-14";
    const result = evaluateApplicability({
      rule: { kind: "school_days" },
      date,
      isoWeekday: 1,
      nextDate: addHouseholdDays(date, 1),
      nextIsoWeekday: 2,
      schoolToday: { status: "unconfigured" },
      schoolTomorrow: { status: "unconfigured" },
    });
    expect(result).toMatchObject({ include: false, unresolved: true });
  });
});

describe("calendar draft validation", () => {
  it("rejects overlapping years and out-of-year exceptions", () => {
    const issues = validateSchoolCalendarDraft([
      {
        startDate: "2026-09-01",
        endDate: "2027-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [{ name: "Bad", startDate: "2027-07-01", endDate: "2027-07-02" }],
      },
      {
        startDate: "2027-06-01",
        endDate: "2028-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [],
      },
    ]);
    expect(issues.some((i) => /overlap/i.test(i.message))).toBe(true);
    expect(issues.some((i) => /within their school year/i.test(i.message))).toBe(true);
  });

  it("rejects invalid leap dates", () => {
    const issues = validateSchoolCalendarDraft([
      {
        startDate: "2025-02-29",
        endDate: "2025-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [],
      },
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts successive nonoverlapping years including leap day", () => {
    const issues = validateSchoolCalendarDraft([
      {
        startDate: "2025-09-01",
        endDate: "2026-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [],
      },
      {
        startDate: "2026-09-01",
        endDate: "2027-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [{ name: "Leap break", startDate: "2028-02-29", endDate: "2028-02-29" }],
      },
    ]);
    // Second-year exception outside that year bounds → invalid; first pair alone is fine.
    expect(issues.some((i) => /within their school year/i.test(i.message))).toBe(true);

    const ok = validateSchoolCalendarDraft([
      {
        startDate: "2023-09-01",
        endDate: "2024-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [{ name: "Leap day off", startDate: "2024-02-29", endDate: "2024-02-29" }],
      },
      {
        startDate: "2024-09-01",
        endDate: "2025-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [],
      },
    ]);
    expect(ok).toEqual([]);
  });
});

describe("multi-year and overlapping exceptions (AT2)", () => {
  const multiYear = {
    years: [
      {
        startDate: "2025-09-01",
        endDate: "2026-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [{ startDate: "2025-12-22", endDate: "2026-01-02" }],
      },
      {
        startDate: "2026-09-01",
        endDate: "2027-06-15",
        usualWeekdays: [1, 2, 3, 4, 5],
        exceptions: [
          { startDate: "2026-10-10", endDate: "2026-10-14" },
          { startDate: "2026-10-12", endDate: "2026-10-16" }, // overlap union
        ],
      },
    ],
  };

  it("evaluates each year independently and treats summer as no-school", () => {
    expect(isSchoolDayForDate("2025-09-15", multiYear, 1)).toEqual({
      status: "configured",
      isSchoolDay: true,
    });
    expect(isSchoolDayForDate("2026-07-10", multiYear, 5)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2026-09-14", multiYear, 1)).toEqual({
      status: "configured",
      isSchoolDay: true,
    });
  });

  it("unions overlapping exceptions", () => {
    expect(isSchoolDayForDate("2026-10-10", multiYear, 6)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2026-10-13", multiYear, 2)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2026-10-16", multiYear, 5)).toEqual({
      status: "configured",
      isSchoolDay: false,
    });
    expect(isSchoolDayForDate("2026-10-19", multiYear, 1)).toEqual({
      status: "configured",
      isSchoolDay: true,
    });
  });

  it("resolves household midnight/DST via householdDateFromInstant (device TZ independent)", () => {
    // America/New_York spring-forward 2024-03-10: 2am → 3am local.
    const eveningBefore = householdDateFromInstant(
      "2024-03-10T04:30:00.000Z",
      "America/New_York",
    );
    const morningAfter = householdDateFromInstant(
      "2024-03-10T08:00:00.000Z",
      "America/New_York",
    );
    expect(eveningBefore).toBe("2024-03-09");
    expect(morningAfter).toBe("2024-03-10");
    // Same UTC instant in Tokyo is a later calendar date — household TZ wins.
    const tokyo = householdDateFromInstant("2024-03-10T04:30:00.000Z", "Asia/Tokyo");
    expect(tokyo).toBe("2024-03-10");
    expect(tokyo).not.toBe(eveningBefore);
  });
});

describe("weekdays/weekends/selected_days rules", () => {
  it("evaluates weekday/weekend and selected_days independently of school context", () => {
    expect(decide({ kind: "weekdays" }, "2026-09-14").include).toBe(true);
    expect(decide({ kind: "weekdays" }, "2026-09-12").include).toBe(false);
    expect(decide({ kind: "weekends" }, "2026-09-12").include).toBe(true);
    expect(decide({ kind: "selected_days", weekdays: [1, 3] }, "2026-09-14").include).toBe(
      true,
    );
    expect(decide({ kind: "selected_days", weekdays: [1, 3] }, "2026-09-15").include).toBe(
      false,
    );
  });
});
