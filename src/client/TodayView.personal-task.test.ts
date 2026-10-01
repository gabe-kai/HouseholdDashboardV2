import { describe, expect, it } from "vitest";
import { applyPersonalTaskStatusResult } from "./TodayView";
import type { PersonalTask } from "./api";

function task(overrides: Partial<PersonalTask> & Pick<PersonalTask, "id">): PersonalTask {
  return {
    householdId: "hh",
    ownerMembershipId: "owner",
    title: "Task",
    visibility: "household",
    status: "open",
    showOnSharedDashboard: true,
    sharingVersion: 2,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("applyPersonalTaskStatusResult", () => {
  it("merges status fields without restoring stale sharing or promotion", () => {
    const current = [
      task({
        id: "t1",
        visibility: "private",
        showOnSharedDashboard: false,
        sharingVersion: 3,
        status: "open",
      }),
    ];
    const staleStatusResponse = task({
      id: "t1",
      visibility: "household",
      showOnSharedDashboard: true,
      sharingVersion: 2,
      status: "completed",
      completedAt: "2026-09-29T11:00:00.000Z",
      updatedAt: "2026-09-29T11:00:00.000Z",
    });

    const next = applyPersonalTaskStatusResult(current, "t1", staleStatusResponse);
    expect(next[0]).toMatchObject({
      id: "t1",
      visibility: "private",
      showOnSharedDashboard: false,
      sharingVersion: 3,
      status: "completed",
      completedAt: "2026-09-29T11:00:00.000Z",
      updatedAt: "2026-09-29T11:00:00.000Z",
    });
  });
});
