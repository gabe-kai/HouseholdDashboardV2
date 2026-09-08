import type { OccurrenceStepView, OccurrenceView, StepStatus } from "../shared/schemas.js";
import { isOccurrenceComplete } from "./completion.js";

export type PendingStepCommand = {
  mutationId: string;
  occurrenceId: string;
  stepId: string;
  status: StepStatus;
};

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
