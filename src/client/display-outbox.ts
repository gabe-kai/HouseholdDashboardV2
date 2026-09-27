/**
 * Display-only IndexedDB intent queue (P0-007C-3A).
 * Keyed by display session id — never by membership, and never shares member outbox.ts.
 * Stores minimal command fields only (no names, step text, snapshots, or credentials).
 */
import { get, set, del, update } from "idb-keyval";
import type { IntendedStructure, StepStatus, WorkKind } from "../shared/schemas";

export type DisplayOutboxItem = {
  mutationId: string;
  occurrenceId: string;
  stepId: string;
  status: StepStatus;
  performedAt: string;
  activityGeneration?: number;
  kind?: WorkKind;
  householdDate: string;
  intendedStructure: IntendedStructure;
  displaySessionId: string;
  displayId: string;
  householdId: string;
  state: "pending" | "retrying" | "rejected";
  errorMessage?: string;
};

/** Session-scoped IndexedDB key — isolated from member outboxes and other displays. */
export function outboxStorageKey(sessionId: string): string {
  return `hd-display-outbox-v1:${sessionId}`;
}

function keyForSession(sessionId: string): string {
  return outboxStorageKey(sessionId);
}

export async function readDisplayOutbox(sessionId: string): Promise<DisplayOutboxItem[]> {
  return (await get<DisplayOutboxItem[]>(keyForSession(sessionId))) ?? [];
}

export async function writeDisplayOutbox(
  sessionId: string,
  items: DisplayOutboxItem[],
): Promise<void> {
  await set(keyForSession(sessionId), items);
}

export async function enqueueDisplayOutbox(
  sessionId: string,
  item: DisplayOutboxItem,
): Promise<DisplayOutboxItem[]> {
  let next: DisplayOutboxItem[] = [];
  await update<DisplayOutboxItem[]>(keyForSession(sessionId), (current) => {
    next = [...(current ?? []), item];
    return next;
  });
  return next;
}

export async function removeDisplayOutboxItem(
  sessionId: string,
  mutationId: string,
): Promise<DisplayOutboxItem[]> {
  let next: DisplayOutboxItem[] = [];
  await update<DisplayOutboxItem[]>(keyForSession(sessionId), (current) => {
    next = (current ?? []).filter((i) => i.mutationId !== mutationId);
    return next;
  });
  return next;
}

export async function clearDisplaySessionOutbox(sessionId: string): Promise<void> {
  await del(keyForSession(sessionId));
}

export async function patchDisplayOutboxItem(
  sessionId: string,
  mutationId: string,
  patch: Partial<DisplayOutboxItem>,
): Promise<DisplayOutboxItem[]> {
  let next: DisplayOutboxItem[] = [];
  await update<DisplayOutboxItem[]>(keyForSession(sessionId), (current) => {
    next = (current ?? []).map((i) =>
      i.mutationId === mutationId ? { ...i, ...patch } : i,
    );
    return next;
  });
  return next;
}

/**
 * Rapid taps on the same step keep the latest desired status and one active
 * pending/retrying lineage: prior unfinished commands for that step are superseded.
 */
export async function replaceDesiredStateForStep(
  sessionId: string,
  item: DisplayOutboxItem,
): Promise<DisplayOutboxItem[]> {
  let next: DisplayOutboxItem[] = [];
  await update<DisplayOutboxItem[]>(keyForSession(sessionId), (current) => {
    const kept = (current ?? []).filter(
      (existing) =>
        !(
          existing.occurrenceId === item.occurrenceId &&
          existing.stepId === item.stepId &&
          (existing.state === "pending" || existing.state === "retrying")
        ),
    );
    next = [...kept, item];
    return next;
  });
  return next;
}

/** Drop pending/retrying commands that no longer match the authoritative day/generation. */
export async function retireMismatchedDisplayOutbox(
  sessionId: string,
  opts: { activityGeneration: number; householdDate: string },
): Promise<DisplayOutboxItem[]> {
  let next: DisplayOutboxItem[] = [];
  await update<DisplayOutboxItem[]>(keyForSession(sessionId), (current) => {
    next = (current ?? []).filter((item) => {
      if (item.state === "rejected") return true;
      if (item.householdDate !== opts.householdDate) return false;
      if (
        item.activityGeneration != null &&
        item.activityGeneration < opts.activityGeneration
      ) {
        return false;
      }
      return true;
    });
    return next;
  });
  return next;
}
