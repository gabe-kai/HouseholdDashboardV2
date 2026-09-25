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

  it("broadcasts sanitized display events and closes by session/display", () => {
    const hub = new SyncHub();
    hubs.push(hub);
    const displayA = new FakeSocket();
    const displayB = new FakeSocket();
    const member = new FakeSocket();
    hub.add("hh-local", member as never);
    hub.addDisplay(
      { householdId: "hh-local", displayId: "d1", sessionId: "s1" },
      displayA as never,
    );
    hub.addDisplay(
      { householdId: "hh-local", displayId: "d2", sessionId: "s2" },
      displayB as never,
    );

    hub.broadcastDisplay("hh-local", {
      type: "display_invalidate",
      householdId: "hh-local",
      reason: "work",
      at: "2026-09-25T12:00:00.000Z",
    });
    expect(displayA.sent).toHaveLength(1);
    expect(displayB.sent).toHaveLength(1);
    expect(member.sent).toHaveLength(0);
    expect(JSON.parse(displayA.sent[0]!).reason).toBe("work");
    expect(JSON.parse(displayA.sent[0]!)).not.toHaveProperty("resourceId");

    hub.closeDisplaySession("s1");
    expect(displayA.readyState).toBe(3);
    expect(displayB.readyState).toBe(1);

    hub.closeDisplay("d2");
    expect(displayB.readyState).toBe(3);
  });

});
