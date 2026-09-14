import { describe, expect, it } from "vitest";
import { isLockingStepStatus, isOccurrenceStarted } from "./occurrence-lock.js";

describe("occurrence-lock", () => {
  it("treats completed and not_needed as locking first actions", () => {
    expect(isLockingStepStatus("completed")).toBe(true);
    expect(isLockingStepStatus("not_needed")).toBe(true);
    expect(isLockingStepStatus("open")).toBe(false);
  });

  it("treats started_at as monotonic started marker", () => {
    expect(isOccurrenceStarted(null)).toBe(false);
    expect(isOccurrenceStarted(undefined)).toBe(false);
    expect(isOccurrenceStarted("")).toBe(false);
    expect(isOccurrenceStarted("2026-09-14T12:00:00.000Z")).toBe(true);
  });
});
