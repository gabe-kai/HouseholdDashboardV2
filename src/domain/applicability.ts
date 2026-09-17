/**
 * Closed step-applicability vocabulary (P0-006B / D-029).
 * Persist discriminated values — not UI labels or executable expressions.
 */
export type ApplicabilityRule =
  | { kind: "every_time" }
  | { kind: "school_days" }
  | { kind: "no_school_days" }
  | { kind: "school_nights" }
  | { kind: "weekdays" }
  | { kind: "weekends" }
  | { kind: "selected_days"; weekdays: number[] };

export const DEFAULT_APPLICABILITY: ApplicabilityRule = { kind: "every_time" };

export type SchoolDayContext =
  | { status: "unconfigured" }
  | { status: "configured"; isSchoolDay: boolean };

/** True when D is inside a year, matches usual weekdays, and is outside no-school exceptions. */
export function isSchoolDayForDate(
  date: string,
  calendar: {
    years: Array<{
      startDate: string;
      endDate: string;
      usualWeekdays: number[];
      exceptions: Array<{ startDate: string; endDate: string }>;
    }>;
  } | null,
  isoWeekday: number,
): SchoolDayContext {
  if (!calendar || calendar.years.length === 0) {
    return { status: "unconfigured" };
  }
  const year = calendar.years.find(
    (y) => date >= y.startDate && date <= y.endDate,
  );
  if (!year) {
    return { status: "configured", isSchoolDay: false };
  }
  const inException = year.exceptions.some(
    (ex) => date >= ex.startDate && date <= ex.endDate,
  );
  if (inException) {
    return { status: "configured", isSchoolDay: false };
  }
  return {
    status: "configured",
    isSchoolDay: year.usualWeekdays.includes(isoWeekday),
  };
}

export type ApplicabilityDecision =
  | { include: true; reason: string }
  | { include: false; reason: string }
  | { include: false; unresolved: true; reason: string };

/**
 * Decide whether a step applies on household date D.
 * School nights: include when D+1 is a school day, using the same calendar edition.
 */
export function evaluateApplicability(input: {
  rule: ApplicabilityRule;
  date: string;
  isoWeekday: number;
  nextDate: string;
  nextIsoWeekday: number;
  schoolToday: SchoolDayContext;
  schoolTomorrow: SchoolDayContext;
}): ApplicabilityDecision {
  const { rule, schoolToday, schoolTomorrow, isoWeekday } = input;

  switch (rule.kind) {
    case "every_time":
      return { include: true, reason: "Every time this routine runs" };
    case "weekdays":
      return isoWeekday >= 1 && isoWeekday <= 5
        ? { include: true, reason: "Weekday" }
        : { include: false, reason: "Not a weekday" };
    case "weekends":
      return isoWeekday >= 6
        ? { include: true, reason: "Weekend" }
        : { include: false, reason: "Not a weekend" };
    case "selected_days":
      return rule.weekdays.includes(isoWeekday)
        ? { include: true, reason: "Selected day" }
        : { include: false, reason: "Not a selected day" };
    case "school_days":
      if (schoolToday.status === "unconfigured") {
        return {
          include: false,
          unresolved: true,
          reason: "School calendar is not set up",
        };
      }
      return schoolToday.isSchoolDay
        ? { include: true, reason: "School day" }
        : { include: false, reason: "Not a school day" };
    case "no_school_days":
      if (schoolToday.status === "unconfigured") {
        return {
          include: false,
          unresolved: true,
          reason: "School calendar is not set up",
        };
      }
      return !schoolToday.isSchoolDay
        ? { include: true, reason: "No-school day" }
        : { include: false, reason: "School day" };
    case "school_nights":
      if (schoolTomorrow.status === "unconfigured") {
        return {
          include: false,
          unresolved: true,
          reason: "School calendar is not set up",
        };
      }
      return schoolTomorrow.isSchoolDay
        ? { include: true, reason: "School night (tomorrow is a school day)" }
        : { include: false, reason: "Not a school night" };
    default: {
      const _exhaustive: never = rule;
      return _exhaustive;
    }
  }
}

export function ruleNeedsSchoolCalendar(rule: ApplicabilityRule): boolean {
  return (
    rule.kind === "school_days" ||
    rule.kind === "no_school_days" ||
    rule.kind === "school_nights"
  );
}

export function applicabilityLabel(rule: ApplicabilityRule): string | null {
  switch (rule.kind) {
    case "every_time":
      return null;
    case "school_days":
      return "School days";
    case "no_school_days":
      return "No-school days";
    case "school_nights":
      return "School nights";
    case "weekdays":
      return "Weekdays";
    case "weekends":
      return "Weekends";
    case "selected_days":
      return "Selected days";
    default: {
      const _exhaustive: never = rule;
      return _exhaustive;
    }
  }
}

export function normalizeApplicability(rule: ApplicabilityRule): ApplicabilityRule {
  if (rule.kind !== "selected_days") return rule;
  const weekdays = [...new Set(rule.weekdays)]
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  return { kind: "selected_days", weekdays };
}

export function serializeApplicability(rule: ApplicabilityRule): string {
  return JSON.stringify(normalizeApplicability(rule));
}

export function parseApplicability(raw: string | null | undefined): ApplicabilityRule {
  if (raw == null || raw === "") return DEFAULT_APPLICABILITY;
  try {
    const parsed = JSON.parse(raw) as ApplicabilityRule;
    if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) {
      return DEFAULT_APPLICABILITY;
    }
    return normalizeApplicability(parsed);
  } catch {
    return DEFAULT_APPLICABILITY;
  }
}
