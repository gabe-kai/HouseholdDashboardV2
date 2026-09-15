import { compareHouseholdDates } from "./time.js";

export type ScheduleEntryLike = {
  id: string;
  startDate: string;
  revisionId: string;
  canceledAt?: string | null;
};

function isActiveEntry(entry: ScheduleEntryLike): boolean {
  return entry.canceledAt == null;
}

/** Active (non-canceled) schedule entries, sorted by startDate ascending. */
export function activeScheduleEntries<T extends ScheduleEntryLike>(entries: T[]): T[] {
  return entries
    .filter(isActiveEntry)
    .sort((a, b) => compareHouseholdDates(a.startDate, b.startDate));
}

/** Greatest active startDate <= date; null if none. */
export function selectScheduleEntryForDate<T extends ScheduleEntryLike>(
  entries: T[],
  date: string,
): T | null {
  const eligible = activeScheduleEntries(entries).filter(
    (e) => compareHouseholdDates(e.startDate, date) <= 0,
  );
  return eligible.length === 0 ? null : eligible[eligible.length - 1]!;
}

/** Earliest active startDate strictly > afterDate, or null. */
export function nextScheduleBoundary(
  entries: ScheduleEntryLike[],
  afterDate: string,
): string | null {
  const next = activeScheduleEntries(entries).find(
    (e) => compareHouseholdDates(e.startDate, afterDate) > 0,
  );
  return next?.startDate ?? null;
}

/** Next schedule boundary after fromDate, or null (open-ended). */
export function governedRangeEndExclusive(
  fromDate: string,
  entries: ScheduleEntryLike[],
): string | null {
  return nextScheduleBoundary(entries, fromDate);
}

/** fromDate <= date < endExclusive (no upper bound when endExclusive is null). */
export function isDateInGovernedRange(
  date: string,
  fromDate: string,
  endExclusive: string | null,
): boolean {
  if (compareHouseholdDates(date, fromDate) < 0) return false;
  if (endExclusive !== null && compareHouseholdDates(date, endExclusive) >= 0) return false;
  return true;
}

/**
 * Sorted unique dates in the governed range: always includes fromDate, plus any
 * knownDates that fall in range. Does not invent a calendar beyond known dates.
 */
export function enumerateAffectedDates(
  fromDate: string,
  endExclusive: string | null,
  knownDates: string[],
): string[] {
  const dates = new Set<string>();
  dates.add(fromDate);
  for (const d of knownDates) {
    if (isDateInGovernedRange(d, fromDate, endExclusive)) {
      dates.add(d);
    }
  }
  return [...dates].sort(compareHouseholdDates);
}
