import { describe, expect, it } from "vitest";
import {
  buildMemberGrants,
  deriveRoleLabel,
  isEssentialManagerGrants,
  mergePermissionGrants,
  GRANT_PRESETS,
} from "./grants.js";

describe("P0-008C grant helpers", () => {
  it("labels manager and member presets", () => {
    expect(deriveRoleLabel(GRANT_PRESETS.manager)).toBe("manager");
    expect(deriveRoleLabel(buildMemberGrants("approval"))).toBe("member");
    expect(deriveRoleLabel(buildMemberGrants("direct"))).toBe("member");
  });

  it("labels customized when mixed", () => {
    expect(
      deriveRoleLabel(["routine.execute.own", "household.member.enroll"]),
    ).toBe("customized");
  });

  it("detects essential manager grants", () => {
    expect(isEssentialManagerGrants(GRANT_PRESETS.manager)).toBe(true);
    expect(isEssentialManagerGrants(buildMemberGrants("approval"))).toBe(false);
  });

  it("preserves unknown legacy grants on merge", () => {
    const merged = mergePermissionGrants({
      role: "member",
      memberMode: "approval",
      secondaryGrants: [],
      priorGrants: ["legacy.custom.grant", "routine.execute.own"],
      knownGrants: Object.values(GRANT_PRESETS.manager).flat(),
    });
    expect(merged).toContain("legacy.custom.grant");
    expect(merged).toContain("routine.personalize.propose");
    expect(merged).not.toContain("routine.personalize.direct");
  });
});
