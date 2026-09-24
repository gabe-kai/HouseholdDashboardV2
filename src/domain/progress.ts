import { isOccurrenceStarted } from "./occurrence-lock.js";

/** Minimal step shape for progress counting (status + optional obligation). */
export type ProgressStep = {
  status: string;
  obligation?: string;
};

/**
 * Step-level progress counts.
 * - `done`: status === "completed" (performed work)
 * - `notNeeded`: status === "not_needed"
 * - `open`: status === "open" (includes optional-open)
 * - `optionalOpen`: open steps with obligation === "optional"
 *
 * Do not treat `done === total` as occurrence completion; use
 * `isOccurrenceComplete` from `./completion.js` for domain completion.
 */
export type StepProgressCounts = {
  done: number;
  notNeeded: number;
  open: number;
  optionalOpen: number;
  total: number;
};

export type WorkState = "Not started" | "In progress" | "Complete";

export function stepProgressCounts(steps: ProgressStep[]): StepProgressCounts {
  let done = 0;
  let notNeeded = 0;
  let open = 0;
  let optionalOpen = 0;

  for (const step of steps) {
    if (step.status === "completed") {
      done += 1;
      continue;
    }
    if (step.status === "not_needed") {
      notNeeded += 1;
      continue;
    }
    open += 1;
    if (step.obligation === "optional") {
      optionalOpen += 1;
    }
  }

  return {
    done,
    notNeeded,
    open,
    optionalOpen,
    total: steps.length,
  };
}

/**
 * Compact progress copy. Prefer "N/M done" when there is no Not needed /
 * optional-open context; otherwise spell out unambiguous parts.
 */
export function formatStepProgress(counts: StepProgressCounts): string {
  const { done, notNeeded, open, optionalOpen, total } = counts;
  const needsContext = notNeeded > 0 || optionalOpen > 0;

  if (!needsContext) {
    return `${done}/${total} done`;
  }

  const parts: string[] = [`${done} done`];
  if (notNeeded > 0) {
    parts.push(`${notNeeded} not needed`);
  }
  if (optionalOpen > 0) {
    parts.push(`${optionalOpen} optional open`);
  }
  const blockingOpen = open - optionalOpen;
  if (blockingOpen > 0) {
    parts.push(`${blockingOpen} open`);
  }
  return parts.join(" · ");
}

/**
 * Neutral checklist work state from occurrence flags and step touch.
 * Uses the occurrence `completed` flag (domain completion), not done/total.
 */
export function workState(occurrence: {
  completed: boolean;
  startedAt: string | null;
  steps: Array<{ status: string }>;
}): WorkState {
  if (occurrence.completed) return "Complete";
  if (isOccurrenceInProgress(occurrence)) return "In progress";
  return "Not started";
}

/** In progress means started or carrying any non-open projected step. */
export function isOccurrenceInProgress(occurrence: {
  startedAt: string | null;
  steps: Array<{ status: string }>;
}): boolean {
  if (isOccurrenceStarted(occurrence.startedAt)) return true;
  return occurrence.steps.some((step) => step.status !== "open");
}
