import { isValidHouseholdDate } from "./time.js";

export type SchoolYearInput = {
  id?: string;
  startDate: string;
  endDate: string;
  usualWeekdays: number[];
  exceptions: Array<{
    id?: string;
    name: string;
    startDate: string;
    endDate: string;
  }>;
};

export type CalendarValidationIssue = { path: string; message: string };

/** Validate school-year ranges without JS Date silent rollover. */
export function validateSchoolCalendarDraft(
  years: SchoolYearInput[],
): CalendarValidationIssue[] {
  const issues: CalendarValidationIssue[] = [];
  if (years.length === 0) {
    issues.push({ path: "years", message: "At least one school year is required." });
    return issues;
  }

  const sorted = [...years].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 0; i < sorted.length; i += 1) {
    const year = sorted[i]!;
    const prefix = `years[${i}]`;
    if (!isValidHouseholdDate(year.startDate) || !isValidHouseholdDate(year.endDate)) {
      issues.push({ path: prefix, message: "School year dates must be real calendar dates." });
      continue;
    }
    if (year.startDate > year.endDate) {
      issues.push({
        path: `${prefix}.endDate`,
        message: "School year end must be on or after start.",
      });
    }
    const weekdays = [...new Set(year.usualWeekdays)].filter((d) => d >= 1 && d <= 7);
    if (weekdays.length === 0) {
      issues.push({
        path: `${prefix}.usualWeekdays`,
        message: "Choose at least one usual school weekday.",
      });
    }
    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (year.startDate <= prev.endDate) {
        issues.push({
          path: prefix,
          message: "School years must not overlap.",
        });
      }
    }
    for (let j = 0; j < year.exceptions.length; j += 1) {
      const ex = year.exceptions[j]!;
      const exPath = `${prefix}.exceptions[${j}]`;
      if (!ex.name.trim()) {
        issues.push({ path: `${exPath}.name`, message: "Exception name is required." });
      }
      if (!isValidHouseholdDate(ex.startDate) || !isValidHouseholdDate(ex.endDate)) {
        issues.push({ path: exPath, message: "Exception dates must be real calendar dates." });
        continue;
      }
      if (ex.startDate > ex.endDate) {
        issues.push({
          path: `${exPath}.endDate`,
          message: "Exception end must be on or after start.",
        });
      }
      if (ex.startDate < year.startDate || ex.endDate > year.endDate) {
        issues.push({
          path: exPath,
          message: "Exceptions must lie within their school year.",
        });
      }
    }
  }
  return issues;
}
