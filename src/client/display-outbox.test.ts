import { describe, expect, it } from "vitest";
import {
  rejectedDisplayOutboxNotices,
  retireDisplayOutboxItems,
  type DisplayOutboxItem,
} from "./display-outbox.js";

function pendingItem(
  patch: Partial<DisplayOutboxItem> &
    Pick<DisplayOutboxItem, "mutationId" | "householdDate">,
): DisplayOutboxItem {
  return {
    occurrenceId: "occ-1",
    stepId: "step-1",
    status: "completed",
    performedAt: "2026-09-26T12:00:00.000Z",
    activityGeneration: 0,
    kind: "responsibility",
    intendedStructure: {
      revisionId: "rev-1",
      accountableMemberId: "m1",
      stepLogicalIds: ["logical-1"],
    },
    displaySessionId: "sess-1",
    displayId: "disp-1",
    householdId: "hh-1",
    state: "pending",
    ...patch,
  };
}

describe("retireDisplayOutboxItems", () => {
  it("rejects prior-day pending commands with an explanation and keeps them", () => {
    const items = [
      pendingItem({ mutationId: "m-old-day", householdDate: "2026-09-25" }),
      pendingItem({ mutationId: "m-today", householdDate: "2026-09-26" }),
    ];
    const next = retireDisplayOutboxItems(items, {
      activityGeneration: 0,
      householdDate: "2026-09-26",
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({
      mutationId: "m-old-day",
      state: "rejected",
      errorMessage: expect.stringMatching(/previous day/i),
    });
    expect(next[1]?.state).toBe("pending");
  });

  it("rejects prior-generation pending commands with an explanation", () => {
    const items = [
      pendingItem({
        mutationId: "m-old-gen",
        householdDate: "2026-09-26",
        activityGeneration: 1,
      }),
    ];
    const next = retireDisplayOutboxItems(items, {
      activityGeneration: 2,
      householdDate: "2026-09-26",
    });
    expect(next[0]).toMatchObject({
      state: "rejected",
      errorMessage: expect.stringMatching(/activity was reset/i),
    });
  });

  it("does not replay already-rejected items or mutate matching pending ones", () => {
    const items = [
      pendingItem({
        mutationId: "m-rejected",
        householdDate: "2026-09-25",
        state: "rejected",
        errorMessage: "Already explained",
      }),
      pendingItem({
        mutationId: "m-ok",
        householdDate: "2026-09-26",
        activityGeneration: 3,
      }),
    ];
    const next = retireDisplayOutboxItems(items, {
      activityGeneration: 3,
      householdDate: "2026-09-26",
    });
    expect(next[0]?.errorMessage).toBe("Already explained");
    expect(next[1]?.state).toBe("pending");
  });
});

describe("rejectedDisplayOutboxNotices", () => {
  it("surfaces rejected explanations for overview feedback", () => {
    const notices = rejectedDisplayOutboxNotices([
      pendingItem({
        mutationId: "m1",
        householdDate: "2026-09-25",
        state: "rejected",
        errorMessage: "This change was for a previous day and was not saved.",
      }),
      pendingItem({ mutationId: "m2", householdDate: "2026-09-26" }),
    ]);
    expect(notices).toEqual([
      {
        mutationId: "m1",
        message: "This change was for a previous day and was not saved.",
      },
    ]);
  });
});
