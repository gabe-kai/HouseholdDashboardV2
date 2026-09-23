import { compareHouseholdDates, type HouseholdDate } from "./time.js";
import type { IntendedStructure, WorkKind } from "../shared/schemas.js";

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

/**
 * Resolve accountable membership(s) for a dated plan.
 * Routines: multi-participant union of directs + dated groups.
 * Responsibilities: exactly one fixed owner; groups are never expanded.
 */
export function resolveAccountableMembers(
  kind: WorkKind,
  input: { directMemberIds: string[]; groupMemberIdSets: string[][] },
): string[] {
  if (kind === "responsibility") {
    const owner = input.directMemberIds[0];
    return owner ? [owner] : [];
  }
  return resolveParticipants(input);
}

/** Whether intended responsibility structure matches the current occurrence snapshot. */
export function intendedStructureMatches(
  intended: IntendedStructure,
  current: {
    revisionId: string;
    accountableMemberId: string | null;
    stepLogicalIds: Array<string | null>;
    structureFingerprint?: string | null;
  },
): boolean {
  if (intended.revisionId !== current.revisionId) return false;
  if (intended.accountableMemberId !== current.accountableMemberId) return false;
  if (
    intended.structureFingerprint &&
    current.structureFingerprint &&
    intended.structureFingerprint !== current.structureFingerprint
  ) {
    return false;
  }
  const currentIds = current.stepLogicalIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (intended.stepLogicalIds.length !== currentIds.length) return false;
  return intended.stepLogicalIds.every((id, index) => id === currentIds[index]);
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
