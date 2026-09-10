import { describe, expect, it } from "vitest";
import {
  reconcileOccurrence,
  type PendingStepCommand,
} from "./reconcile.js";
import type { OccurrenceView } from "../shared/schemas.js";

function baseOccurrence(overrides?: Partial<OccurrenceView>): OccurrenceView {
  return {
    id: "occ-1",
    householdDate: "2026-09-10",
    definitionId: "def-1",
    revisionId: "rev-1",
    accountableMemberId: "mem-1",
    accountableMemberName: "Avery",
    title: "Morning Routine",
    scheduleAnchor: "morning",
    version: 1,
    completed: false,
    steps: [
      {
        id: "step-a",
        position: 0,
        text: "Make bed",
        obligation: "required",
        status: "open",
        source: "shared",
        logicalItemId: "logic-a",
      },
      {
        id: "step-b",
        position: 1,
        text: "Stretch",
        obligation: "optional",
        status: "open",
        source: "shared",
        logicalItemId: "logic-b",
      },
    ],
    ...overrides,
  };
}

describe("reconcileOccurrence (stale/out-of-order intent)", () => {
  it("leaves authoritative snapshot unchanged without pending commands", () => {
    const occurrence = baseOccurrence();
    expect(reconcileOccurrence(occurrence, [])).toEqual(occurrence);
  });

  it("overlays pending intent so optimistic UI wins over older authoritative status", () => {
    const occurrence = baseOccurrence({
      steps: [
        {
          id: "step-a",
          position: 0,
          text: "Make bed",
          obligation: "required",
          status: "open",
          source: "shared",
          logicalItemId: "logic-a",
        },
      ],
      completed: false,
    });
    const pending: PendingStepCommand[] = [
      {
        mutationId: "m1",
        occurrenceId: "occ-1",
        stepId: "step-a",
        status: "completed",
      },
    ];
    const next = reconcileOccurrence(occurrence, pending);
    expect(next.steps[0]?.status).toBe("completed");
    expect(next.completed).toBe(true);
  });

  it("lets later pending commands for the same step win (duplicate/out-of-order queue)", () => {
    const occurrence = baseOccurrence();
    const pending: PendingStepCommand[] = [
      {
        mutationId: "m-old",
        occurrenceId: "occ-1",
        stepId: "step-a",
        status: "completed",
      },
      {
        mutationId: "m-new",
        occurrenceId: "occ-1",
        stepId: "step-a",
        status: "open",
      },
    ];
    const next = reconcileOccurrence(occurrence, pending);
    expect(next.steps[0]?.status).toBe("open");
    expect(next.completed).toBe(false);
  });

  it("ignores pending commands for other occurrences", () => {
    const occurrence = baseOccurrence();
    const pending: PendingStepCommand[] = [
      {
        mutationId: "m1",
        occurrenceId: "occ-other",
        stepId: "step-a",
        status: "completed",
      },
    ];
    expect(reconcileOccurrence(occurrence, pending).steps[0]?.status).toBe("open");
  });
});
