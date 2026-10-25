import { describe, expect, it } from "vitest";
import { proposedSaveDate } from "./proposed-save-date";

describe("proposedSaveDate (P0-008E AT8)", () => {
  it("rebases an implicit today start and keeps a later startingDate", () => {
    expect(proposedSaveDate("2026-10-21", "2026-10-21", "2026-10-22")).toBe("2026-10-22");
    expect(proposedSaveDate("2026-10-25", "2026-10-21", "2026-10-22")).toBe("2026-10-25");
  });
});
