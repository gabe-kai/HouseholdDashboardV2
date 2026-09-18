import { describe, expect, it } from "vitest";
import {
  normalizeOptionalText,
  validateBirthday,
  validateEmail,
  validateFriendlyName,
  validateProfileFields,
} from "./profile.js";

describe("profile validation", () => {
  it("requires friendly name within 1-80 chars", () => {
    expect(validateFriendlyName("").length).toBeGreaterThan(0);
    expect(validateFriendlyName("   ").length).toBeGreaterThan(0);
    expect(validateFriendlyName("A")).toEqual([]);
    expect(validateFriendlyName("x".repeat(81)).length).toBeGreaterThan(0);
  });

  it("normalizes optional blanks to unset", () => {
    expect(normalizeOptionalText("  ")).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeNull();
    expect(normalizeOptionalText(" Ada ")).toBe("Ada");
  });

  it("rejects impossible and future birthdays against household today", () => {
    expect(validateBirthday("2024-02-30", "2026-09-17").length).toBeGreaterThan(0);
    expect(validateBirthday("2026-09-18", "2026-09-17").length).toBeGreaterThan(0);
    expect(validateBirthday("2020-02-29", "2026-09-17")).toEqual([]);
    expect(validateBirthday(null, "2026-09-17")).toEqual([]);
  });

  it("validates optional email without requiring uniqueness semantics", () => {
    expect(validateEmail("not-an-email").length).toBeGreaterThan(0);
    expect(validateEmail("parent@example.test")).toEqual([]);
    expect(validateEmail("")).toEqual([]);
  });

  it("aggregates profile field issues", () => {
    const issues = validateProfileFields({
      displayName: "",
      fullName: "x".repeat(200),
      birthday: "2099-01-01",
      email: "bad",
      householdToday: "2026-09-17",
    });
    expect(issues.map((i) => i.path).sort()).toEqual([
      "birthday",
      "displayName",
      "email",
      "fullName",
    ]);
  });
});
