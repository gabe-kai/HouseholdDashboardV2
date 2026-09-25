import type { Daypart } from "./daypart.js";
import { compareOccurrenceOrder } from "./daypart.js";
import { isOccurrenceInProgress } from "./progress.js";

/**
 * Minimal occurrence shape for personal-day projection.
 * Callers may pass fuller OccurrenceView objects; only these fields are read.
 */
export type ProjectableOccurrence = {
  id: string;
  definitionId: string;
  daypart: Daypart;
  completed: boolean;
  startedAt: string | null;
  kind?: string;
  steps: Array<{ status: string; obligation?: string }>;
  title?: string;
};

/** Minimal personal-task shape; creation order + id drive stable sorting. */
export type ProjectablePersonalTask = {
  id: string;
  status: string;
  createdAt: string;
};

export type PersonalDayProjection<
  O extends ProjectableOccurrence = ProjectableOccurrence,
  T extends ProjectablePersonalTask = ProjectablePersonalTask,
> = {
  completed: O[];
  /** At most one unfinished non-anytime occurrence. */
  next: O | null;
  later: O[];
  anytimeOccurrences: O[];
  openPersonalTasks: T[];
  completedPersonalTasks: T[];
  /**
   * Occurrence id to expand initially: next, else first anytime occurrence.
   * Never a personal-task id (checklist focus only).
   */
  recommendedFocusId: string | null;
};

function compareProjectedOccurrence(
  a: ProjectableOccurrence,
  b: ProjectableOccurrence,
): number {
  const byDaypartDef = compareOccurrenceOrder(a, b);
  if (byDaypartDef !== 0) return byDaypartDef;
  return a.id.localeCompare(b.id);
}

function comparePersonalTask(
  a: ProjectablePersonalTask,
  b: ProjectablePersonalTask,
): number {
  const byCreated = a.createdAt.localeCompare(b.createdAt);
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

/**
 * Pure personal-day projection over authorized own occurrences and own tasks.
 * Does not invent "all done" messaging; empty inputs yield empty sections.
 * Kind never influences ordering. Does not read Date.now / browser timezone.
 */
export function projectPersonalDay<
  O extends ProjectableOccurrence,
  T extends ProjectablePersonalTask,
>(occurrences: readonly O[], personalTasks: readonly T[]): PersonalDayProjection<O, T> {
  const completed = occurrences
    .filter((occurrence) => occurrence.completed)
    .slice()
    .sort(compareProjectedOccurrence);

  const unfinished = occurrences.filter((occurrence) => !occurrence.completed);
  const scheduledUnfinished = unfinished.filter(
    (occurrence) => occurrence.daypart !== "anytime",
  );
  const anytimeOccurrences = unfinished
    .filter((occurrence) => occurrence.daypart === "anytime")
    .slice()
    .sort(compareProjectedOccurrence);

  const inProgressScheduled = scheduledUnfinished.filter((occurrence) =>
    isOccurrenceInProgress(occurrence),
  );
  const nextPool =
    inProgressScheduled.length > 0 ? inProgressScheduled : scheduledUnfinished;
  const next =
    nextPool.slice().sort(compareProjectedOccurrence)[0] ?? null;

  const later = scheduledUnfinished
    .filter((occurrence) => occurrence.id !== next?.id)
    .slice()
    .sort(compareProjectedOccurrence);

  const openPersonalTasks = personalTasks
    .filter((task) => task.status !== "completed")
    .slice()
    .sort(comparePersonalTask);
  const completedPersonalTasks = personalTasks
    .filter((task) => task.status === "completed")
    .slice()
    .sort(comparePersonalTask);

  const recommendedFocusId =
    next?.id ?? anytimeOccurrences[0]?.id ?? null;

  return {
    completed,
    next,
    later,
    anytimeOccurrences,
    openPersonalTasks,
    completedPersonalTasks,
    recommendedFocusId,
  };
}
