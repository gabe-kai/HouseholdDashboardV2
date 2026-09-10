import { afterEach, describe, expect, it, vi } from "vitest";
import { newClientId } from "./id.js";

describe("newClientId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a UUID-shaped id when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
        return bytes;
      },
    });
    const id = newClientId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("falls back when randomUUID throws (insecure context)", () => {
    vi.stubGlobal("crypto", {
      randomUUID() {
        throw new Error("Secure context required");
      },
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(7);
        return bytes;
      },
    });
    expect(newClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
