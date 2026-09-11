import { get, set, del, update } from "idb-keyval";
import type { StepStatus } from "../shared/schemas";

export type OutboxItem = {
  mutationId: string;
  occurrenceId: string;
  stepId: string;
  status: StepStatus;
  performedAt: string;
  state: "pending" | "retrying" | "rejected";
  errorMessage?: string;
};

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
