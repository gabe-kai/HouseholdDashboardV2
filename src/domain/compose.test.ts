import { describe, expect, it } from "vitest";
import { composeMorningRoutine } from "./compose.js";

describe("composeMorningRoutine", () => {
  const shared = [
    { logicalItemId: "s1", text: "Make bed", obligation: "required" as const },
    { logicalItemId: "s2", text: "Brush teeth", obligation: "required" as const },
  ];

  it("appends personal items at end of inherited content when unanchored", () => {
    const composed = composeMorningRoutine(shared, [
      {
        id: "p1",
        text: "Pack soccer bag",
        obligation: "as_needed",
        anchorLogicalItemId: null,
        place: "end",
      },
    ]);
    expect(composed.map((c) => c.text)).toEqual([
      "Make bed",
      "Brush teeth",
      "Pack soccer bag",
    ]);
    expect(composed[2].source).toBe("personal");
  });

  it("inserts before/after anchors and falls back when anchor missing", () => {
    const composed = composeMorningRoutine(shared, [
      {
        id: "p1",
        text: "Clean breakfast",
        obligation: "optional",
        anchorLogicalItemId: "s1",
        place: "after",
      },
      {
        id: "p2",
        text: "Orphan",
        obligation: "optional",
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
