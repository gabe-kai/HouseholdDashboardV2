import { describe, expect, it } from "vitest";
import { composeMorningRoutine } from "./compose.js";
import { DEFAULT_APPLICABILITY } from "./applicability.js";

describe("composeMorningRoutine", () => {
  const shared = [
    {
      logicalItemId: "s1",
      text: "Make bed",
      obligation: "required" as const,
      applicability: DEFAULT_APPLICABILITY,
    },
    {
      logicalItemId: "s2",
      text: "Brush teeth",
      obligation: "required" as const,
      applicability: DEFAULT_APPLICABILITY,
    },
  ];

  it("appends personal items at end of inherited content when unanchored", () => {
    const composed = composeMorningRoutine(shared, [
      {
        id: "p1",
        text: "Pack soccer bag",
        obligation: "as_needed",
        applicability: DEFAULT_APPLICABILITY,
        anchorLogicalItemId: null,
        place: "end",
      },
    ]);
    expect(composed.map((c) => c.text)).toEqual([
      "Make bed",
      "Brush teeth",
      "Pack soccer bag",
    ]);
    expect(composed[2]!.source).toBe("personal");
  });

  it("inserts before/after anchors and falls back when anchor missing", () => {
    const composed = composeMorningRoutine(shared, [
      {
        id: "p1",
        text: "Clean breakfast",
        obligation: "optional",
        applicability: DEFAULT_APPLICABILITY,
        anchorLogicalItemId: "s1",
        place: "after",
      },
      {
        id: "p2",
        text: "Orphan",
        obligation: "optional",
        applicability: DEFAULT_APPLICABILITY,
        anchorLogicalItemId: "missing",
        place: "after",
      },
    ]);
    expect(composed.map((c) => c.text)).toEqual([
      "Make bed",
      "Clean breakfast",
      "Brush teeth",
      "Orphan",
    ]);
  });
});
