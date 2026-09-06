import { compareHouseholdDates, isoWeekdayForHouseholdDate, type HouseholdDate } from "./time.js";

export type RoutineRevisionLike = {
  id: string;
  effectiveDate: HouseholdDate;
  weekdays: number[];
};

export function isDateApplicable(householdDate: HouseholdDate, weekdays: number[]): boolean {
  const weekday = isoWeekdayForHouseholdDate(householdDate);
  return weekdays.includes(weekday);
}

/** Select the revision with the greatest effectiveDate <= householdDate. */
export function selectRevisionForDate<T extends RoutineRevisionLike>(
  revisions: T[],
  householdDate: HouseholdDate,
): T | null {
  const eligible = revisions
    .filter((r) => compareHouseholdDates(r.effectiveDate, householdDate) <= 0)
    .sort((a, b) => compareHouseholdDates(b.effectiveDate, a.effectiveDate));
  return eligible[0] ?? null;
}

export function validateRoutineSteps(
  steps: Array<{ text: string; obligation: string }>,
): { ok: true } | { ok: false; message: string } {
  if (steps.length === 0) {
    return { ok: false, message: "At least one step is required" };
  }
  if (steps.some((s) => !s.text.trim())) {
    return { ok: false, message: "Every step must have non-empty text" };
  }
  if (!steps.some((s) => s.obligation === "required")) {
    return { ok: false, message: "At least one required step is necessary" };
  }
  return { ok: true };
}
