import { describe, expect, it } from "vitest";
import {
  familyPaneItemsForSection,
  projectFamilyPane,
} from "./family-wall-projection.js";
import type { ProjectableOccurrence } from "./today-projection.js";

function occ(
  partial: Partial<ProjectableOccurrence> &
    Pick<ProjectableOccurrence, "id" | "definitionId" | "daypart">,
): ProjectableOccurrence {
  return {
    completed: false,
    startedAt: null,
    steps: [{ status: "open", obligation: "required" }],
    ...partial,
  };
}

describe("projectFamilyPane (AT3a/AT3b/AT3c)", () => {
  it("AT3a: prefers in-progress scheduled work over earlier unstarted and Anytime", () => {
    const morningOpen = occ({
      id: "morning",
      definitionId: "def-m",
      daypart: "morning",
    });
    const afterStarted = occ({
      id: "after",
      definitionId: "def-a",
      daypart: "after_school",
      startedAt: "2026-10-28T12:00:00.000Z",
      steps: [{ status: "completed", obligation: "required" }, { status: "open", obligation: "required" }],
    });
    const anytime = occ({
      id: "any",
      definitionId: "def-any",
      daypart: "anytime",
    });
    const projection = projectFamilyPane([morningOpen, afterStarted, anytime]);
    expect(projection.next?.id).toBe("after");
    expect(projection.recommendedFocusId).toBe("after");
    expect(projection.upcoming.map((item) => item.id)).toContain("any");
  });

  it("AT3a: undoing a step to open does not drop a started occurrence from next", () => {
    const started = occ({
      id: "started",
      definitionId: "def-s",
      daypart: "morning",
      startedAt: "2026-10-28T12:00:00.000Z",
      steps: [
        { status: "open", obligation: "required", id: "s1" },
        { status: "open", obligation: "required", id: "s2" },
      ],
    });
    const later = occ({
      id: "later",
      definitionId: "def-l",
      daypart: "evening",
    });
    const projection = projectFamilyPane([started, later]);
    expect(projection.next?.id).toBe("started");
    expect(projection.firstOpenStepId).toBe("s1");
  });

  it("AT3b: empty assigned work is no-work, never complete", () => {
    expect(projectFamilyPane([]).emptyKind).toBe("no-work");
    expect(projectFamilyPane([], { filteredOmission: true }).emptyKind).toBe(
      "filtered-omission",
    );
  });

  it("AT3b: only Anytime is labeled anytime-only", () => {
    const anytime = occ({
      id: "any",
      definitionId: "def-any",
      daypart: "anytime",
    });
    const projection = projectFamilyPane([anytime]);
    expect(projection.next?.id).toBe("any");
    expect(projection.emptyKind).toBe("anytime-only");
  });

  it("AT3b: later unfinished remains distinct from next", () => {
    const morning = occ({
      id: "morning",
      definitionId: "def-m",
      daypart: "morning",
    });
    const evening = occ({
      id: "evening",
      definitionId: "def-e",
      daypart: "evening",
    });
    const projection = projectFamilyPane([morning, evening]);
    expect(projection.next?.id).toBe("morning");
    expect(projection.upcoming.map((item) => item.id)).toEqual(["evening"]);
    expect(projection.emptyKind).toBe("later-remaining");
  });

  it("AT3c: optional open after required complete stays reachable", () => {
    const work = occ({
      id: "opt",
      definitionId: "def-opt",
      daypart: "morning",
      completed: true,
      steps: [
        { status: "completed", obligation: "required" },
        { status: "open", obligation: "optional" },
      ],
    });
    const projection = projectFamilyPane([work]);
    expect(projection.completed[0]?.id).toBe("opt");
    expect(projection.emptyKind).toBe("complete-optional");
    expect(familyPaneItemsForSection(projection, "earlier")[0]?.id).toBe("opt");
  });

  it("AT3c: unresolved As needed does not vanish into all-done when other work remains", () => {
    const needed = occ({
      id: "need",
      definitionId: "def-need",
      daypart: "after_school",
      steps: [{ status: "open", obligation: "as_needed" }],
    });
    const projection = projectFamilyPane([needed]);
    expect(projection.next?.id).toBe("need");
    expect(projection.next?.completed).toBe(false);
  });
});
