import type { OccurrenceStepView, OccurrenceView, StepStatus } from "../shared/schemas.js";
import { isOccurrenceComplete } from "./completion.js";
import { isLockingStepStatus, isOccurrenceStarted } from "./occurrence-lock.js";

export type PendingStepCommand = {
  mutationId: string;
  occurrenceId: string;
  stepId: string;
  status: StepStatus;
};

export function hasPendingFirstAction(
  occurrenceId: string,
  pending: PendingStepCommand[],
): boolean {
  return pending.some(
    (command) =>
      command.occurrenceId === occurrenceId && isLockingStepStatus(command.status),
  );
}

/** True when server lock or pending first-execution intent protects structure (D-023). */
export function isStructurallyProtected(
  occurrence: OccurrenceView,
  pending: PendingStepCommand[],
): boolean {
  return (
    isOccurrenceStarted(occurrence.startedAt) ||
    hasPendingFirstAction(occurrence.id, pending)
  );
}

/** Overlay still-pending desired-state commands onto an authoritative occurrence snapshot. */
export function reconcileOccurrence(
  occurrence: OccurrenceView,
  pending: PendingStepCommand[],
): OccurrenceView {
  const relevant = pending.filter((p) => p.occurrenceId === occurrence.id);
  if (relevant.length === 0) {
    return occurrence;
  }

  // Later pending commands for the same step win (client queue order).
  const byStep = new Map<string, StepStatus>();
  for (const cmd of relevant) {
    byStep.set(cmd.stepId, cmd.status);
  }

  const steps: OccurrenceStepView[] = occurrence.steps.map((step) => {
    const overlay = byStep.get(step.id);
    return overlay ? { ...step, status: overlay } : step;
  });

  return {
    ...occurrence,
    steps,
    completed: isOccurrenceComplete(steps),
  };
}

/**
 * Merge authoritative Today refresh with local state.
 * Pending first-action intent keeps local structure (never apply a later structural refresh).
 * If the server omits an occurrence (e.g. all steps filtered) while a first action is still
 * pending, retain the local card until the command is acknowledged or rejected.
 */
export function mergeAuthoritativeOccurrence(
  previous: OccurrenceView | undefined,
  authoritative: OccurrenceView,
  pending: PendingStepCommand[],
): OccurrenceView {
  if (
    previous &&
    previous.id === authoritative.id &&
    hasPendingFirstAction(previous.id, pending)
  ) {
    return reconcileOccurrence(previous, pending);
  }
  return reconcileOccurrence(authoritative, pending);
}

/** Keep local occurrences that vanished from the server while first-action intent is pending. */
export function retainPendingOmittedOccurrences(
  previous: OccurrenceView[],
  authoritative: OccurrenceView[],
  pending: PendingStepCommand[],
): OccurrenceView[] {
  const retained = authoritative.map((occurrence) =>
    mergeAuthoritativeOccurrence(
      previous.find((item) => item.id === occurrence.id),
      occurrence,
      pending,
    ),
  );
  const authoritativeIds = new Set(authoritative.map((occurrence) => occurrence.id));
  for (const local of previous) {
    if (authoritativeIds.has(local.id)) continue;
    if (!hasPendingFirstAction(local.id, pending)) continue;
    retained.push(reconcileOccurrence(local, pending));
  }
  return retained;
}
