import type { Daypart } from "./daypart.js";
import { compareOccurrenceOrder, daypartOrder } from "./daypart.js";
import {
  formatStepProgress,
  isOccurrenceInProgress,
  stepProgressCounts,
  workState,
  type StepProgressCounts,
  type WorkState,
} from "./progress.js";

/**
 * Minimal occurrence shape for household overview aggregation.
 * Missing `kind` normalizes to routine (legacy clients).
 */
export type OverviewOccurrence = {
  id: string;
  definitionId: string;
  householdDate: string;
  daypart: Daypart;
  title: string;
  kind?: string;
  accountableMemberId: string | null;
  accountableMemberName?: string;
  completed: boolean;
  startedAt: string | null;
  steps: Array<{ status: string; obligation?: string }>;
};

export type ResponsibilityOverviewRow = {
  id: string;
  definitionId: string;
  householdDate: string;
  daypart: Daypart;
  title: string;
  accountableMemberId: string | null;
  accountableMemberName: string;
  completed: boolean;
  state: WorkState;
  progress: StepProgressCounts;
  progressLabel: string;
  pending: boolean;
  occurrence: OverviewOccurrence;
};

export type RoutinePersonRow = {
  accountableMemberId: string | null;
  /** Display name; null member uses "Unassigned". */
  accountableMemberName: string;
  occurrenceId: string;
  title: string;
  completed: boolean;
  state: WorkState;
  pending: boolean;
  progress: StepProgressCounts;
};

export type RoutineAggregateRow = {
  /** Stable aggregate identity: `${definitionId}::${householdDate}`. */
  key: string;
  definitionId: string;
  householdDate: string;
  daypart: Daypart;
  /**
   * Display label only — never identity.
   * One unique title → that title;
   * two unique titles → sorted `"A / B"`;
   * more → `"Multiple titles"`.
   */
  displayTitle: string;
  people: RoutinePersonRow[];
  /** Completed people (occurrences), not step counts. */
  completedCount: number;
  /** Represented applicable people in this aggregate. */
  applicableCount: number;
  overallState: WorkState;
  pending: boolean;
};

export type HouseholdOverview = {
  responsibilities: ResponsibilityOverviewRow[];
  routines: RoutineAggregateRow[];
};

export type BuildHouseholdOverviewOptions = {
  pendingOccurrenceIds?: ReadonlySet<string>;
};

function isResponsibility(occurrence: OverviewOccurrence): boolean {
  return occurrence.kind === "responsibility";
}

function memberKey(accountableMemberId: string | null): string {
  return accountableMemberId ?? "__unassigned__";
}

function memberDisplayName(occurrence: OverviewOccurrence): string {
  if (occurrence.accountableMemberId === null) return "Unassigned";
  return occurrence.accountableMemberName ?? occurrence.accountableMemberId;
}

/**
 * Aggregate display title from represented snapshot titles.
 * Documented policy: 1 → that title; 2 → sorted join with " / "; else "Multiple titles".
 */
export function routineDisplayTitle(titles: readonly string[]): string {
  const unique = [...new Set(titles)].sort((a, b) => a.localeCompare(b));
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} / ${unique[1]}`;
  return "Multiple titles";
}

function compareResponsibility(a: OverviewOccurrence, b: OverviewOccurrence): number {
  const byDaypart = daypartOrder(a.daypart) - daypartOrder(b.daypart);
  if (byDaypart !== 0) return byDaypart;
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.id.localeCompare(b.id);
}

function compareRoutineMember(a: OverviewOccurrence, b: OverviewOccurrence): number {
  const byOrder = compareOccurrenceOrder(a, b);
  if (byOrder !== 0) return byOrder;
  return a.id.localeCompare(b.id);
}

function aggregateOverallState(
  occurrences: readonly OverviewOccurrence[],
): WorkState {
  if (occurrences.length === 0) return "Not started";
  if (occurrences.every((occurrence) => occurrence.completed)) {
    return "Complete";
  }
  const anyBegun = occurrences.some(
    (occurrence) =>
      occurrence.completed || isOccurrenceInProgress(occurrence),
  );
  return anyBegun ? "In progress" : "Not started";
}

function toResponsibilityRow(
  occurrence: OverviewOccurrence,
  pending: boolean,
): ResponsibilityOverviewRow {
  const progress = stepProgressCounts(occurrence.steps);
  return {
    id: occurrence.id,
    definitionId: occurrence.definitionId,
    householdDate: occurrence.householdDate,
    daypart: occurrence.daypart,
    title: occurrence.title,
    accountableMemberId: occurrence.accountableMemberId,
    accountableMemberName: memberDisplayName(occurrence),
    completed: occurrence.completed,
    state: workState(occurrence),
    progress,
    progressLabel: formatStepProgress(progress),
    pending,
    occurrence,
  };
}

function toPersonRow(
  occurrence: OverviewOccurrence,
  pending: boolean,
): RoutinePersonRow {
  return {
    accountableMemberId: occurrence.accountableMemberId,
    accountableMemberName: memberDisplayName(occurrence),
    occurrenceId: occurrence.id,
    title: occurrence.title,
    completed: occurrence.completed,
    state: workState(occurrence),
    pending,
    progress: stepProgressCounts(occurrence.steps),
  };
}

/**
 * Household overview: one row per responsibility occurrence; routines
 * aggregated by definitionId + householdDate with person (not step) counts.
 */
export function buildHouseholdOverview(
  occurrences: readonly OverviewOccurrence[],
  options?: BuildHouseholdOverviewOptions,
): HouseholdOverview {
  const pendingIds = options?.pendingOccurrenceIds;

  const responsibilityOccurrences = occurrences
    .filter(isResponsibility)
    .slice()
    .sort(compareResponsibility);

  const responsibilities = responsibilityOccurrences.map((occurrence) =>
    toResponsibilityRow(occurrence, pendingIds?.has(occurrence.id) ?? false),
  );

  const routineOccurrences = occurrences.filter(
    (occurrence) => !isResponsibility(occurrence),
  );

  const byKey = new Map<string, OverviewOccurrence[]>();
  for (const occurrence of routineOccurrences) {
    const key = `${occurrence.definitionId}::${occurrence.householdDate}`;
    const list = byKey.get(key) ?? [];
    list.push(occurrence);
    byKey.set(key, list);
  }

  const routines: RoutineAggregateRow[] = [];
  for (const [key, group] of byKey) {
    // Unique people by accountableMemberId (null → Unassigned).
    const byMember = new Map<string, OverviewOccurrence>();
    const sortedGroup = group.slice().sort(compareRoutineMember);
    for (const occurrence of sortedGroup) {
      const mk = memberKey(occurrence.accountableMemberId);
      if (!byMember.has(mk)) {
        byMember.set(mk, occurrence);
      }
    }
    const peopleOccurrences = [...byMember.values()];
    if (peopleOccurrences.length === 0) continue;

    const people = peopleOccurrences.map((occurrence) =>
      toPersonRow(occurrence, pendingIds?.has(occurrence.id) ?? false),
    );
    const completedCount = people.filter((person) => person.completed).length;
    const daypart = peopleOccurrences
      .slice()
      .sort(
        (a, b) =>
          daypartOrder(a.daypart) - daypartOrder(b.daypart) ||
          a.id.localeCompare(b.id),
      )[0]!.daypart;

    routines.push({
      key,
      definitionId: peopleOccurrences[0]!.definitionId,
      householdDate: peopleOccurrences[0]!.householdDate,
      daypart,
      displayTitle: routineDisplayTitle(
        peopleOccurrences.map((occurrence) => occurrence.title),
      ),
      people,
      completedCount,
      applicableCount: people.length,
      overallState: aggregateOverallState(peopleOccurrences),
      pending: people.some((person) => person.pending),
    });
  }

  routines.sort((a, b) => {
    const byDaypart = daypartOrder(a.daypart) - daypartOrder(b.daypart);
    if (byDaypart !== 0) return byDaypart;
    return a.definitionId.localeCompare(b.definitionId);
  });

  return { responsibilities, routines };
}
