import { describe, expect, it } from "vitest";
import { isTrustedLanHttpOrigin, originMatchesConfig } from "./origin.js";

describe("LAN origin helpers", () => {
  it("accepts private and loopback http origins", () => {
    expect(isTrustedLanHttpOrigin("http://192.168.1.42:5173")).toBe(true);
    expect(isTrustedLanHttpOrigin("http://10.0.0.8:5173")).toBe(true);
    expect(isTrustedLanHttpOrigin("http://172.16.5.1:5173")).toBe(true);
    expect(isTrustedLanHttpOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isTrustedLanHttpOrigin("http://localhost:5173")).toBe(true);
  });

  it("rejects public, https, and malformed origins", () => {
    expect(isTrustedLanHttpOrigin("https://192.168.1.42:5173")).toBe(false);
    expect(isTrustedLanHttpOrigin("http://evil.example")).toBe(false);
    expect(isTrustedLanHttpOrigin("http://8.8.8.8:5173")).toBe(false);
    expect(isTrustedLanHttpOrigin("not-a-url")).toBe(false);
  });

  it("matches configured origin or LAN peers when allowLan", () => {
    expect(
      originMatchesConfig("http://127.0.0.1:5173", "http://127.0.0.1:5173", false),
    ).toBe(true);
    expect(
      originMatchesConfig("http://192.168.1.42:5173", "http://127.0.0.1:5173", false),
    ).toBe(false);
    expect(
      originMatchesConfig("http://192.168.1.42:5173", "http://127.0.0.1:5173", true),
    ).toBe(true);
    expect(
      originMatchesConfig("https://evil.example", "http://127.0.0.1:5173", true),
    ).toBe(false);
  });
});
