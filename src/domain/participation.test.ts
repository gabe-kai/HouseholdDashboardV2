import { describe, expect, it } from "vitest";
import {
  normalizeDirectSources,
  resolveParticipants,
  revisionIntervalActiveFrom,
  selectMembershipVersionForDate,
  unionMembershipIds,
} from "./participation.js";

describe("participation resolver", () => {
  it("unions and sorts deterministically", () => {
    expect(unionMembershipIds(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
    expect(
      resolveParticipants({
        directMemberIds: ["m2"],
        groupMemberIdSets: [["m1", "m2"], ["m3"]],
      }),
    ).toEqual(["m1", "m2", "m3"]);
  });

  it("normalizes redundant directs covered by groups", () => {
    expect(
      normalizeDirectSources({
        directMemberIds: ["eli", "sarah"],
        groupMemberIdSets: [["eli", "daniel"]],
      }),
    ).toEqual(["sarah"]);
  });

  it("selects greatest version on the same effective date", () => {
    const selected = selectMembershipVersionForDate(
      [
        { version: 1, effectiveDate: "2026-01-01", members: ["a"] },
        { version: 2, effectiveDate: "2026-01-02", members: ["a", "b"] },
        { version: 3, effectiveDate: "2026-01-02", members: ["b"] },
      ],
      "2026-01-02",
    );
    expect(selected?.version).toBe(3);
  });

  it("detects active revision intervals", () => {
    expect(revisionIntervalActiveFrom("2026-01-01", null, "2026-01-10")).toBe(true);
    expect(revisionIntervalActiveFrom("2026-01-01", "2026-01-05", "2026-01-10")).toBe(false);
    expect(revisionIntervalActiveFrom("2026-01-01", "2026-01-15", "2026-01-10")).toBe(true);
  });
});
