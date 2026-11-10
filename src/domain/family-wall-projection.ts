import type { Daypart } from "./daypart.js";
import { daypartOrder } from "./daypart.js";
import { projectPersonalDay, type ProjectableOccurrence } from "./today-projection.js";

export type FamilyPaneSection = "next" | "earlier" | "upcoming" | "more";

export type FamilyPaneEmptyKind =
  | "no-work"
  | "filtered-omission"
  | "anytime-only"
  | "later-remaining"
  | "complete-optional"
  | "complete";

export type FamilyPaneProjection<O extends ProjectableOccurrence = ProjectableOccurrence> = {
  next: O | null;
  earlier: O[];
  upcoming: O[];
  more: O[];
  anytime: O[];
  completed: O[];
  recommendedFocusId: string | null;
  firstOpenStepId: string | null;
  emptyKind: FamilyPaneEmptyKind | null;
};

const UPCOMING_PREVIEW = 4;

function firstOpenStepId(occurrence: ProjectableOccurrence): string | null {
  const open = occurrence.steps.find((step) => step.status === "open");
  return open && "id" in open && typeof open.id === "string" ? open.id : null;
}

function hasOpenOptional(occurrence: ProjectableOccurrence): boolean {
  return occurrence.steps.some(
    (step) => step.obligation === "optional" && step.status === "open",
  );
}

function hasOpenAsNeeded(occurrence: ProjectableOccurrence): boolean {
  return occurrence.steps.some(
    (step) => step.obligation === "as_needed" && step.status === "open",
  );
}

/**
 * Pane sections over allowlisted assigned occurrences. Reuses projectPersonalDay
 * for next/later/anytime; does not invent a second scheduler.
 */
export function projectFamilyPane<O extends ProjectableOccurrence>(
  occurrences: readonly O[],
  options: { filteredOmission?: boolean } = {},
): FamilyPaneProjection<O> {
  const day = projectPersonalDay(occurrences, []);
  const next = day.next ?? (day.anytimeOccurrences[0] ?? null);
  const nextId = next?.id ?? null;
  const earlier = [
    ...day.completed,
    ...day.later.filter((item) => daypartOrder(item.daypart as Daypart) < daypartOrder((next?.daypart ?? "anytime") as Daypart)),
  ];
  const upcomingScheduled = day.later.filter((item) => !earlier.includes(item));
  const remainingAnytime = day.anytimeOccurrences.filter((item) => item.id !== nextId);
  const upcomingAll = [...upcomingScheduled, ...remainingAnytime];
  const upcoming = upcomingAll.slice(0, UPCOMING_PREVIEW);
  const more = upcomingAll.slice(UPCOMING_PREVIEW);

  let emptyKind: FamilyPaneEmptyKind | null = null;
  if (occurrences.length === 0) {
    emptyKind = options.filteredOmission ? "filtered-omission" : "no-work";
  } else if (!next && day.completed.length > 0) {
    emptyKind = occurrences.some(hasOpenOptional) ? "complete-optional" : "complete";
  } else if (next && next.daypart === "anytime" && day.later.length === 0) {
    emptyKind = "anytime-only";
  } else if (next && upcomingAll.length > 0) {
    emptyKind = "later-remaining";
  } else if (next && occurrences.some(hasOpenAsNeeded) && next.completed) {
    emptyKind = "complete-optional";
  }

  return {
    next,
    earlier,
    upcoming,
    more,
    anytime: day.anytimeOccurrences,
    completed: day.completed,
    recommendedFocusId: day.recommendedFocusId,
    firstOpenStepId: next ? firstOpenStepId(next) : null,
    emptyKind,
  };
}

export function paneOccurrenceStartedAt(occurrence: {
  startedAt?: string | null;
  state?: string;
}): string | null {
  if (occurrence.startedAt) return occurrence.startedAt;
  if (occurrence.state === "In progress") return "in-progress";
  return null;
}

export function toFamilyPaneOccurrence<O extends {
  id: string;
  definitionId: string;
  daypart: string;
  completed: boolean;
  startedAt?: string | null;
  state?: string;
  steps: ProjectableOccurrence["steps"];
  title?: string;
}>(occurrence: O): ProjectableOccurrence {
  return {
    id: occurrence.id,
    definitionId: occurrence.definitionId,
    daypart: occurrence.daypart as Daypart,
    completed: occurrence.completed,
    startedAt: paneOccurrenceStartedAt(occurrence),
    steps: occurrence.steps,
    title: occurrence.title,
  };
}

export function familyPaneItemsForSection<O extends ProjectableOccurrence>(
  projection: FamilyPaneProjection<O>,
  section: FamilyPaneSection,
): O[] {
  if (section === "earlier") return projection.earlier;
  if (section === "upcoming") return projection.upcoming;
  if (section === "more") return [...projection.upcoming, ...projection.more];
  return projection.next ? [projection.next] : [];
}
