import type { HouseholdDate } from "./time.js";

/** Snapshotted daypart vocabulary (D-021). Storage / wire values. */
export const DAYPARTS = [
  "morning",
  "after_school",
  "evening",
  "bedtime",
  "anytime",
] as const;

export type Daypart = (typeof DAYPARTS)[number];

const DAYPART_ORDER: Record<Daypart, number> = {
  morning: 0,
  after_school: 1,
  evening: 2,
  bedtime: 3,
  anytime: 4,
};

export const DAYPART_LABELS: Record<Daypart, string> = {
  morning: "Morning",
  after_school: "After school",
  evening: "Evening",
  bedtime: "Bedtime",
  anytime: "Anytime",
};

export function isDaypart(value: string): value is Daypart {
  return (DAYPARTS as readonly string[]).includes(value);
}

export function daypartOrder(daypart: Daypart): number {
  return DAYPART_ORDER[daypart];
}

/** Compare two occurrences for Today ordering: daypart then definition id. */
export function compareOccurrenceOrder(
  a: { daypart: Daypart; definitionId: string },
  b: { daypart: Daypart; definitionId: string },
): number {
  const byPart = daypartOrder(a.daypart) - daypartOrder(b.daypart);
  if (byPart !== 0) return byPart;
  return a.definitionId.localeCompare(b.definitionId);
}

/**
 * Archive cutoff is exclusive: participation stops beginning on cutoffDate.
 * Returns true when the target date is still allowed (target < cutoff).
 */
export function isBeforeArchiveCutoff(
  targetDate: HouseholdDate,
  archiveCutoffDate: HouseholdDate | null | undefined,
): boolean {
  if (!archiveCutoffDate) return true;
  return targetDate.localeCompare(archiveCutoffDate) < 0;
}
