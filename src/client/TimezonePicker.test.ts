import { describe, expect, it } from "vitest";
import { isValidIanaTimezoneClient } from "./TimezonePicker";

describe("TimezonePicker helpers (P0-008E AT2)", () => {
  it("accepts common IANA zones and rejects empty/invalid", () => {
    expect(isValidIanaTimezoneClient("America/New_York")).toBe(true);
    expect(isValidIanaTimezoneClient("UTC")).toBe(true);
    expect(isValidIanaTimezoneClient("")).toBe(false);
    expect(isValidIanaTimezoneClient("Not/AZone")).toBe(false);
  });
});
