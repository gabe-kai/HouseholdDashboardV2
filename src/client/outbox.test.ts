import { describe, expect, it } from "vitest";
import { outboxStorageKey } from "./outbox.js";

describe("outbox identity keys", () => {
  it("namespaces storage by membership and never collapses identities", () => {
    const a = outboxStorageKey("22222222-2222-4222-8222-222222222202");
    const b = outboxStorageKey("22222222-2222-4222-8222-222222222201");
    expect(a).toBe("hd-outbox-v1:22222222-2222-4222-8222-222222222202");
    expect(b).toBe("hd-outbox-v1:22222222-2222-4222-8222-222222222201");
    expect(a).not.toBe(b);
  });
});
