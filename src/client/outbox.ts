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

const KEY = "hd-outbox-v1";

export async function readOutbox(): Promise<OutboxItem[]> {
  return (await get<OutboxItem[]>(KEY)) ?? [];
}

export async function writeOutbox(items: OutboxItem[]): Promise<void> {
  await set(KEY, items);
}

export async function enqueueOutbox(item: OutboxItem): Promise<OutboxItem[]> {
  let next: OutboxItem[] = [];
  await update<OutboxItem[]>(KEY, (current) => {
    next = [...(current ?? []), item];
    return next;
  });
  return next;
}

export async function removeOutboxItem(mutationId: string): Promise<OutboxItem[]> {
  let next: OutboxItem[] = [];
  await update<OutboxItem[]>(KEY, (current) => {
    next = (current ?? []).filter((i) => i.mutationId !== mutationId);
    return next;
  });
  return next;
}

export async function clearOutbox(): Promise<void> {
  await del(KEY);
}

export async function patchOutboxItem(
  mutationId: string,
  patch: Partial<OutboxItem>,
): Promise<OutboxItem[]> {
  let next: OutboxItem[] = [];
  await update<OutboxItem[]>(KEY, (current) => {
    next = (current ?? []).map((i) => (i.mutationId === mutationId ? { ...i, ...patch } : i));
    return next;
  });
  return next;
}
