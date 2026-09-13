import { compareHouseholdDates, type HouseholdDate } from "./time.js";

/** Deterministic unique union of membership IDs (sorted). */
export function unionMembershipIds(...sets: string[][]): string[] {
  const merged = new Set<string>();
  for (const set of sets) {
    for (const id of set) merged.add(id);
  }
  return [...merged].sort((a, b) => a.localeCompare(b));
}

/**
 * Among membership versions with effectiveDate <= target, pick the greatest version.
 * Ties on effective date are broken by version number (already encoded in "greatest version").
 */
export function selectMembershipVersionForDate<
  T extends { version: number; effectiveDate: HouseholdDate },
>(versions: T[], householdDate: HouseholdDate): T | null {
  const eligible = versions.filter(
    (row) => compareHouseholdDates(row.effectiveDate, householdDate) <= 0,
  );
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const byDate = compareHouseholdDates(b.effectiveDate, a.effectiveDate);
    if (byDate !== 0) return byDate;
    return b.version - a.version;
  });
  return eligible[0]!;
}

export function normalizeDirectSources(input: {
  directMemberIds: string[];
  groupMemberIdSets: string[][];
}): string[] {
  const throughGroups = new Set(unionMembershipIds(...input.groupMemberIdSets));
  return [...new Set(input.directMemberIds)]
    .filter((id) => !throughGroups.has(id))
    .sort((a, b) => a.localeCompare(b));
}

export function resolveParticipants(input: {
  directMemberIds: string[];
  groupMemberIdSets: string[][];
}): string[] {
  return unionMembershipIds(input.directMemberIds, ...input.groupMemberIdSets);
}

/** Whether a revision interval [effectiveDate, nextEffectiveDate) intersects [today, +∞). */
export function revisionIntervalActiveFrom(
  effectiveDate: HouseholdDate,
  nextEffectiveDate: HouseholdDate | null,
  today: HouseholdDate,
): boolean {
  if (nextEffectiveDate === null) return true;
  return compareHouseholdDates(today, nextEffectiveDate) < 0;
}
