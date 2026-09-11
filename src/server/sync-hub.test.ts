import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncHub } from "./sync-hub.js";
import type { SyncNotification } from "../shared/schemas.js";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  ping = vi.fn();
  send(payload: string) {
    this.sent.push(payload);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

describe("SyncHub realtime invalidation", () => {
  const hubs: SyncHub[] = [];
  afterEach(() => {
    for (const hub of hubs.splice(0)) hub.close();
  });

  it("delivers duplicate invalidations safely and isolates households", () => {
    const hub = new SyncHub();
    hubs.push(hub);
    const localA = new FakeSocket();
    const localB = new FakeSocket();
    const foreign = new FakeSocket();
    hub.add("hh-local", localA as never);
    hub.add("hh-local", localB as never);
    hub.add("hh-foreign", foreign as never);

    const note: SyncNotification = {
      type: "household_change",
      householdId: "hh-local",
      resource: "proposal",
      resourceId: "prop-1",
      at: "2026-09-10T12:00:00.000Z",
    };
    hub.broadcast(note);
    hub.broadcast(note);

    expect(localA.sent).toHaveLength(2);
    expect(localB.sent).toHaveLength(2);
    expect(foreign.sent).toHaveLength(0);
    expect(JSON.parse(localA.sent[0]!)).toEqual(note);
    expect(JSON.parse(localA.sent[1]!)).toEqual(note);
  });
});
