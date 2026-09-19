import { describe, expect, it } from "vitest";
import {
  intendedStructureFromOccurrence,
  normalizeOccurrenceKind,
  outboxStorageKey,
  previousOccurrencesFromOutbox,
  type OutboxItem,
} from "./outbox.js";
import type { OccurrenceView } from "../shared/schemas.js";

describe("outbox identity keys", () => {
  it("namespaces storage by membership and never collapses identities", () => {
    const a = outboxStorageKey("22222222-2222-4222-8222-222222222202");
    const b = outboxStorageKey("22222222-2222-4222-8222-222222222201");
    expect(a).toBe("hd-outbox-v1:22222222-2222-4222-8222-222222222202");
    expect(b).toBe("hd-outbox-v1:22222222-2222-4222-8222-222222222201");
    expect(a).not.toBe(b);
  });
});

describe("previousOccurrencesFromOutbox", () => {
  const snapshot = {
    id: "occ-1",
    definitionId: "def-1",
    revisionId: "rev-1",
    householdDate: "2026-09-17",
    title: "Morning",
    daypart: "morning",
    accountableMemberId: "m1",
    accountableMemberName: "Avery",
    version: 1,
    startedAt: null,
    completed: false,
    kind: "routine",
    steps: [],
  } as OccurrenceView;

  it("rebuilds prior cards from durable first-action snapshots", () => {
    const items: OutboxItem[] = [
      {
        mutationId: "mut-1",
        occurrenceId: "occ-1",
        stepId: "step-1",
        status: "completed",
        performedAt: "2026-09-17T12:00:00.000Z",
        state: "pending",
        occurrenceSnapshot: snapshot,
      },
    ];
    expect(previousOccurrencesFromOutbox(items)).toEqual([snapshot]);
  });

  it("normalizes legacy snapshots missing kind to routine", () => {
    const legacy = {
      ...snapshot,
      kind: undefined,
    } as unknown as OccurrenceView;
    const items: OutboxItem[] = [
      {
        mutationId: "mut-1",
        occurrenceId: "occ-1",
        stepId: "step-1",
        status: "completed",
        performedAt: "2026-09-17T12:00:00.000Z",
        state: "pending",
        occurrenceSnapshot: legacy,
      },
    ];
    expect(previousOccurrencesFromOutbox(items)[0]?.kind).toBe("routine");
  });

  it("ignores rejected items and mismatched snapshot ids", () => {
    const items: OutboxItem[] = [
      {
        mutationId: "mut-1",
        occurrenceId: "occ-1",
        stepId: "step-1",
        status: "completed",
        performedAt: "2026-09-17T12:00:00.000Z",
        state: "rejected",
        occurrenceSnapshot: snapshot,
      },
      {
        mutationId: "mut-2",
        occurrenceId: "occ-2",
        stepId: "step-2",
        status: "completed",
        performedAt: "2026-09-17T12:00:00.000Z",
        state: "pending",
        occurrenceSnapshot: { ...snapshot, id: "other" },
      },
    ];
    expect(previousOccurrencesFromOutbox(items)).toEqual([]);
  });
});

describe("responsibility intended structure", () => {
  it("builds structure from responsibility occurrence steps", () => {
    const occurrence = normalizeOccurrenceKind({
      id: "occ-1",
      definitionId: "def-1",
      revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      householdDate: "2026-09-18",
      title: "Cats",
      daypart: "anytime",
      accountableMemberId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      accountableMemberName: "Avery",
      version: 1,
      startedAt: null,
      completed: false,
      kind: "responsibility",
      steps: [
        {
          id: "s1",
          position: 0,
          text: "Feed",
          obligation: "required",
          status: "open",
          source: "shared",
          logicalItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
      ],
    } as OccurrenceView);
    expect(intendedStructureFromOccurrence(occurrence)).toEqual({
      revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      accountableMemberId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      stepLogicalIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
    });
  });
});
