import type { ObligationMeaning, StepStatus } from "../shared/schemas.js";

export type CompletionStep = {
  obligation: ObligationMeaning;
  status: StepStatus;
};

export function isStepSatisfied(step: CompletionStep): boolean {
  if (step.obligation === "optional") {
    return true;
  }
  if (step.obligation === "required") {
    return step.status === "completed";
  }
  return step.status === "completed" || step.status === "not_needed";
}

export function isBlockingStepOpen(step: CompletionStep): boolean {
  if (step.obligation === "optional") {
    return false;
  }
  if (step.obligation === "required") {
    return step.status !== "completed";
  }
  return step.status !== "completed" && step.status !== "not_needed";
}

export function isOccurrenceComplete(steps: CompletionStep[]): boolean {
  return steps.every(isStepSatisfied);
}

export function assertStatusAllowed(
  obligation: ObligationMeaning,
  status: StepStatus,
): void {
  if (status === "not_needed" && obligation !== "as_needed") {
    throw new Error("not_needed is only valid for as_needed steps");
  }
}
