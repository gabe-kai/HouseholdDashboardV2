import { isDateApplicable } from "./recurrence.js";
import {
  addHouseholdDays,
  compareHouseholdDates,
  isoWeekdayForHouseholdDate,
  type HouseholdDate,
} from "./time.js";

export type AssignmentMode = "fixed" | "take_turns" | "weekly";

export type AssignmentSpec = {
  mode: AssignmentMode;
  anchorDate: HouseholdDate;
  fixedMemberId?: string | null;
  cycleOrder?: string[];
  weeklyMap?: Record<string, string>;
  sourceGroupId?: string | null;
  excludedMemberIds?: string[];
  savedRingOrder?: string[];
};

export type AssignmentResolution = {
  accountableMemberId: string | null;
  unassignedReason: string | null;
  opportunityIndex: number | null;
};

export type RingResolver = (
  date: HouseholdDate,
  spec: AssignmentSpec,
) => string[];

export type MemberEligibility = (memberId: string, date: HouseholdDate) => boolean;

/** Zero-based opportunity index for applicable dates from anchor through target inclusive. */
export function opportunityIndexForDate(
  anchorDate: HouseholdDate,
  targetDate: HouseholdDate,
  applicableWeekdays: number[],
): number | null {
  if (compareHouseholdDates(targetDate, anchorDate) < 0) return null;
  if (!isDateApplicable(targetDate, applicableWeekdays)) return null;
  let index = 0;
  let cursor = anchorDate;
  while (compareHouseholdDates(cursor, targetDate) < 0) {
    if (isDateApplicable(cursor, applicableWeekdays)) index += 1;
    cursor = addHouseholdDays(cursor, 1);
  }
  return index;
}

/** Enumerate applicable household dates in [from, to] inclusive. */
export function applicableDatesInRange(
  fromDate: HouseholdDate,
  toDate: HouseholdDate,
  weekdays: number[],
): HouseholdDate[] {
  if (compareHouseholdDates(toDate, fromDate) < 0) return [];
  const dates: HouseholdDate[] = [];
  let cursor = fromDate;
  while (compareHouseholdDates(cursor, toDate) <= 0) {
    if (isDateApplicable(cursor, weekdays)) dates.push(cursor);
    cursor = addHouseholdDays(cursor, 1);
  }
  return dates;
}

function excludedSet(spec: AssignmentSpec): Set<string> {
  return new Set(spec.excludedMemberIds ?? []);
}

/** Resolve explicit cycle order or saved ring, excluding ineligible members. */
export function resolveEligibleRing(
  date: HouseholdDate,
  spec: AssignmentSpec,
  resolveRing: RingResolver,
  isEligible: MemberEligibility,
): string[] {
  const excluded = excludedSet(spec);
  const raw =
    spec.mode === "take_turns" && spec.cycleOrder?.length
      ? spec.cycleOrder
      : resolveRing(date, spec);
  return raw.filter((id) => !excluded.has(id) && isEligible(id, date));
}

export function resolveAssignmentOwner(
  date: HouseholdDate,
  parentWeekdays: number[],
  spec: AssignmentSpec,
  resolveRing: RingResolver,
  isEligible: MemberEligibility,
): AssignmentResolution {
  if (!isDateApplicable(date, parentWeekdays)) {
    return { accountableMemberId: null, unassignedReason: null, opportunityIndex: null };
  }

  if (spec.mode === "fixed") {
    const memberId = spec.fixedMemberId ?? null;
    if (!memberId) {
      return {
        accountableMemberId: null,
        unassignedReason: "No person selected",
        opportunityIndex: null,
      };
    }
    if (!isEligible(memberId, date)) {
      return {
        accountableMemberId: null,
        unassignedReason: "Selected person is not eligible",
        opportunityIndex: null,
      };
    }
    return { accountableMemberId: memberId, unassignedReason: null, opportunityIndex: null };
  }

  if (spec.mode === "weekly") {
    const iso = isoWeekdayForHouseholdDate(date);
    const memberId = spec.weeklyMap?.[String(iso)] ?? null;
    if (!memberId) {
      return {
        accountableMemberId: null,
        unassignedReason: "No weekly assignment for this day",
        opportunityIndex: null,
      };
    }
    if (!isEligible(memberId, date)) {
      return {
        accountableMemberId: null,
        unassignedReason: "Weekly assignee is not eligible",
        opportunityIndex: null,
      };
    }
    return { accountableMemberId: memberId, unassignedReason: null, opportunityIndex: null };
  }

  const ring = resolveEligibleRing(date, spec, resolveRing, isEligible);
  if (ring.length === 0) {
    return {
      accountableMemberId: null,
      unassignedReason: spec.sourceGroupId
        ? "No eligible people in the assignment group"
        : "No eligible people in the turn order",
      opportunityIndex: null,
    };
  }
  const index = opportunityIndexForDate(spec.anchorDate, date, parentWeekdays);
  if (index === null) {
    return {
      accountableMemberId: null,
      unassignedReason: "Date is not applicable",
      opportunityIndex: null,
    };
  }
  const owner = ring[index % ring.length]!;
  return {
    accountableMemberId: owner,
    unassignedReason: null,
    opportunityIndex: index,
  };
}

/** Build durable ring from saved order + group members with admission ordering. */
export function buildGroupBackedRing(
  date: HouseholdDate,
  savedRingOrder: string[],
  currentGroupMembers: string[],
  memberFirstAdmission: (memberId: string) => HouseholdDate | null,
): string[] {
  const memberSet = new Set(currentGroupMembers);
  const ranked = savedRingOrder.filter((id) => memberSet.has(id));
  const rankedSet = new Set(ranked);
  const entrants = currentGroupMembers
    .filter((id) => !rankedSet.has(id))
    .sort((a, b) => {
      const aDate = memberFirstAdmission(a);
      const bDate = memberFirstAdmission(b);
      if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      return a.localeCompare(b);
    });
  return [...ranked, ...entrants];
}
