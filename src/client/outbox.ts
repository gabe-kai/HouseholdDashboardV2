import { get, set, del, update } from "idb-keyval";
import type {
  IntendedStructure,
  OccurrenceView,
  StepStatus,
  WorkKind,
} from "../shared/schemas";

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
  /** Installation dataset epoch when the command was enqueued. */
  installationEpoch?: number;
  /** Closed work kind; missing legacy entries normalize to routine. */
  kind?: WorkKind;
  /** Responsibility first-action structural intent (revision + owner + steps). */
  intendedStructure?: IntendedStructure;
};

/** Normalize legacy snapshots that predate explicit work kind. */
export function normalizeOccurrenceKind(occurrence: OccurrenceView): OccurrenceView {
  if (occurrence.kind === "routine" || occurrence.kind === "responsibility") {
    return occurrence;
  }
  return { ...occurrence, kind: "routine" };
}

export function intendedStructureFromOccurrence(
  occurrence: OccurrenceView,
): IntendedStructure | undefined {
  if (normalizeOccurrenceKind(occurrence).kind !== "responsibility") return undefined;
  const stepLogicalIds = occurrence.steps
    .map((step) => step.logicalItemId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (!occurrence.accountableMemberId) return undefined;
  return {
    revisionId: occurrence.revisionId,
    accountableMemberId: occurrence.accountableMemberId,
    stepLogicalIds,
  };
}

/** Prior local cards reconstructed from durable first-action outbox snapshots. */
export function previousOccurrencesFromOutbox(items: OutboxItem[]): OccurrenceView[] {
  const byId = new Map<string, OccurrenceView>();
  for (const item of items) {
    if (item.state === "rejected") continue;
    if (!item.occurrenceSnapshot) continue;
    if (item.occurrenceSnapshot.id !== item.occurrenceId) continue;
    byId.set(item.occurrenceId, normalizeOccurrenceKind(item.occurrenceSnapshot));
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

const EPOCH_RETIRE_MESSAGE =
  "The household was reset; this checklist change was not saved.";
const LEGACY_EPOCH_RETIRE_MESSAGE =
  "This change was saved before reset protection and was not applied.";

/**
 * Mark pending/retrying commands from another installation epoch as rejected
 * with an explanation. Never silently drop or replay them after reset.
 */
export function retireOutboxItemsForEpoch(
  items: OutboxItem[],
  installationEpoch: number,
): OutboxItem[] {
  return items.map((item) => {
    if (item.state === "rejected") return item;
    if (item.installationEpoch == null) {
      return {
        ...item,
        state: "rejected" as const,
        errorMessage: LEGACY_EPOCH_RETIRE_MESSAGE,
      };
    }
    if (item.installationEpoch !== installationEpoch) {
      return {
        ...item,
        state: "rejected" as const,
        errorMessage: EPOCH_RETIRE_MESSAGE,
      };
    }
    return item;
  });
}

export async function retireMismatchedMemberOutbox(
  membershipId: string,
  installationEpoch: number,
): Promise<OutboxItem[]> {
  let next: OutboxItem[] = [];
  await update<OutboxItem[]>(keyForMembership(membershipId), (current) => {
    next = retireOutboxItemsForEpoch(current ?? [], installationEpoch);
    return next;
  });
  return next;
}
