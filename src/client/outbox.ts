import { get, set, del, update } from "idb-keyval";
import type { OccurrenceView, StepStatus } from "../shared/schemas";

export type OutboxItem = {
  mutationId: string;
  occurrenceId: string;
  stepId: string;
  status: StepStatus;
  performedAt: string;
  state: "pending" | "retrying" | "rejected";
  errorMessage?: string;
  /** Structural snapshot so omitted Today cards can survive reload while pending. */
  occurrenceSnapshot?: OccurrenceView;
  /** Household activity generation when the command was enqueued. */
  activityGeneration?: number;
};

/** Prior local cards reconstructed from durable first-action outbox snapshots. */
export function previousOccurrencesFromOutbox(items: OutboxItem[]): OccurrenceView[] {
  const byId = new Map<string, OccurrenceView>();
  for (const item of items) {
    if (item.state === "rejected") continue;
    if (!item.occurrenceSnapshot) continue;
    if (item.occurrenceSnapshot.id !== item.occurrenceId) continue;
    byId.set(item.occurrenceId, item.occurrenceSnapshot);
  }
  return [...byId.values()];
}

/** Membership-scoped IndexedDB key — never share across identities. */
export function outboxStorageKey(membershipId: string): string {
  return `hd-outbox-v1:${membershipId}`;
}

function keyForMembership(membershipId: string): string {
  return outboxStorageKey(membershipId);
}

export async function readOutbox(membershipId: string): Promise<OutboxItem[]> {
  return (await get<OutboxItem[]>(keyForMembership(membershipId))) ?? [];
}

export async function writeOutbox(
  membershipId: string,
  items: OutboxItem[],
): Promise<void> {
  await set(keyForMembership(membershipId), items);
}

export async function enqueueOutbox(
  membershipId: string,
  item: OutboxItem,
): Promise<OutboxItem[]> {
  let next: OutboxItem[] = [];
  await update<OutboxItem[]>(keyForMembership(membershipId), (current) => {
    next = [...(current ?? []), item];
    return next;
  });
  return next;
}

export async function removeOutboxItem(
  membershipId: string,
  mutationId: string,
): Promise<OutboxItem[]> {
  let next: OutboxItem[] = [];
  await update<OutboxItem[]>(keyForMembership(membershipId), (current) => {
    next = (current ?? []).filter((i) => i.mutationId !== mutationId);
    return next;
  });
  return next;
}

export async function clearMembershipOutbox(membershipId: string): Promise<void> {
  await del(keyForMembership(membershipId));
}

export async function patchOutboxItem(
  membershipId: string,
  mutationId: string,
  patch: Partial<OutboxItem>,
): Promise<OutboxItem[]> {
  let next: OutboxItem[] = [];
  await update<OutboxItem[]>(keyForMembership(membershipId), (current) => {
    next = (current ?? []).map((i) => (i.mutationId === mutationId ? { ...i, ...patch } : i));
    return next;
  });
  return next;
}
