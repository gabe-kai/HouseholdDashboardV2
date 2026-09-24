import { describe, expect, it } from "vitest";
import { isOccurrenceComplete } from "./completion.js";
import {
  formatStepProgress,
  isOccurrenceInProgress,
  stepProgressCounts,
  workState,
} from "./progress.js";

describe("stepProgressCounts", () => {
  it("counts done, not needed, open, and optional-open separately", () => {
    expect(
      stepProgressCounts([
        { status: "completed", obligation: "required" },
        { status: "completed", obligation: "optional" },
        { status: "not_needed", obligation: "as_needed" },
        { status: "open", obligation: "required" },
        { status: "open", obligation: "optional" },
      ]),
    ).toEqual({
      done: 2,
      notNeeded: 1,
      open: 2,
      optionalOpen: 1,
      total: 5,
    });
  });

  it("does not treat done===total as domain completion (empty and optional-open)", () => {
    expect(stepProgressCounts([])).toEqual({
      done: 0,
      notNeeded: 0,
      open: 0,
      optionalOpen: 0,
      total: 0,
    });
    expect(isOccurrenceComplete([])).toBe(false);

    const allOptionalOpen = [
      { obligation: "optional" as const, status: "open" as const },
      { obligation: "optional" as const, status: "open" as const },
    ];
    const counts = stepProgressCounts(allOptionalOpen);
    expect(counts.done).toBe(0);
    expect(counts.optionalOpen).toBe(2);
    expect(isOccurrenceComplete(allOptionalOpen)).toBe(true);

    const requiredDoneOptionalOpen = [
      { obligation: "required" as const, status: "completed" as const },
      { obligation: "as_needed" as const, status: "not_needed" as const },
      { obligation: "optional" as const, status: "open" as const },
    ];
    const mixed = stepProgressCounts(requiredDoneOptionalOpen);
    expect(mixed.done).toBe(1);
    expect(mixed.notNeeded).toBe(1);
    expect(mixed.optionalOpen).toBe(1);
    expect(mixed.done === mixed.total).toBe(false);
    expect(isOccurrenceComplete(requiredDoneOptionalOpen)).toBe(true);
  });
});

describe("formatStepProgress", () => {
  it("uses compact N/M done when no not-needed or optional-open context", () => {
    expect(
      formatStepProgress({
        done: 2,
        notNeeded: 0,
        open: 3,
        optionalOpen: 0,
        total: 5,
      }),
    ).toBe("2/5 done");
  });

  it("spells out not needed and optional-open context unambiguously", () => {
    expect(
      formatStepProgress({
        done: 2,
        notNeeded: 1,
        open: 2,
        optionalOpen: 0,
        total: 5,
      }),
    ).toBe("2 done · 1 not needed · 2 open");

    expect(
      formatStepProgress({
        done: 2,
        notNeeded: 1,
        open: 2,
        optionalOpen: 1,
        total: 5,
      }),
    ).toBe("2 done · 1 not needed · 1 optional open · 1 open");

    expect(
      formatStepProgress({
        done: 0,
        notNeeded: 0,
        open: 2,
        optionalOpen: 2,
        total: 2,
      }),
    ).toBe("0 done · 2 optional open");
  });
});

describe("workState and isOccurrenceInProgress", () => {
  it("returns Complete from the completed flag, not from done/total", () => {
    expect(
      workState({
        completed: true,
        startedAt: "2026-09-24T12:00:00.000Z",
        steps: [
          { status: "completed" },
          { status: "open" }, // optional-open still allowed when complete
        ],
      }),
    ).toBe("Complete");

    expect(
      workState({
        completed: false,
        startedAt: null,
        steps: [
          { status: "completed" },
          { status: "completed" },
        ],
      }),
    ).toBe("In progress");
  });

  it("treats empty steps as not complete and not phantom in-progress", () => {
    expect(
      workState({ completed: false, startedAt: null, steps: [] }),
    ).toBe("Not started");
    expect(
      isOccurrenceInProgress({ startedAt: null, steps: [] }),
    ).toBe(false);
    expect(isOccurrenceComplete([])).toBe(false);
  });

  it("marks in progress when startedAt is set or any step is non-open", () => {
    expect(
      isOccurrenceInProgress({
        startedAt: "2026-09-24T08:00:00.000Z",
        steps: [{ status: "open" }],
      }),
    ).toBe(true);
    expect(
      isOccurrenceInProgress({
        startedAt: null,
        steps: [{ status: "not_needed" }],
      }),
    ).toBe(true);
    expect(
      isOccurrenceInProgress({
        startedAt: null,
        steps: [{ status: "open" }, { status: "open" }],
      }),
    ).toBe(false);
    expect(
      workState({
        completed: false,
        startedAt: null,
        steps: [{ status: "open" }],
      }),
    ).toBe("Not started");
  });
});
