import type { StepStatus } from "../shared/schemas.js";

/** Statuses that lock occurrence structure on first commit (D-023). */
export function isLockingStepStatus(status: StepStatus): boolean {
  return status === "completed" || status === "not_needed";
}

export function isOccurrenceStarted(startedAt: string | null | undefined): boolean {
  return typeof startedAt === "string" && startedAt.length > 0;
}
