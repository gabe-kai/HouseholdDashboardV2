import { describe, expect, it } from "vitest";
import {
  assertStatusAllowed,
  isOccurrenceComplete,
  isStepSatisfied,
} from "./completion.js";

describe("completion semantics", () => {
  it("treats optional steps as non-blocking whether open or completed", () => {
    expect(isStepSatisfied({ obligation: "optional", status: "open" })).toBe(true);
    expect(
      isOccurrenceComplete([
        { obligation: "required", status: "completed" },
        { obligation: "as_needed", status: "not_needed" },
        { obligation: "optional", status: "open" },
      ]),
    ).toBe(true);
  });

  it("requires as_needed to be completed or not_needed", () => {
    expect(isStepSatisfied({ obligation: "as_needed", status: "open" })).toBe(false);
    expect(isStepSatisfied({ obligation: "as_needed", status: "not_needed" })).toBe(true);
  });

  it("reopens occurrence when a blocking step reopens", () => {
    expect(
      isOccurrenceComplete([
        { obligation: "required", status: "open" },
        { obligation: "as_needed", status: "completed" },
      ]),
    ).toBe(false);
  });

  it("treats an empty step list as incomplete", () => {
    expect(isOccurrenceComplete([])).toBe(false);
  });

  it("rejects not_needed for non as_needed steps", () => {
    expect(() => assertStatusAllowed("required", "not_needed")).toThrow();
  });
});
