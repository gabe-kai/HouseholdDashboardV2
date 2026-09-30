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
    hub.add("hh-local", "m-a", localA as never);
    hub.add("hh-local", "m-b", localB as never);
    hub.add("hh-foreign", "m-f", foreign as never);

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
    hub.add("hh-local", "m-1", member as never);
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

  it("keeps private personal-task IDs owner-only and sanitizes household withdrawal", () => {
    const hub = new SyncHub();
    hubs.push(hub);
    const owner = new FakeSocket();
    const peer = new FakeSocket();
    hub.add("hh-local", "owner", owner as never);
    hub.add("hh-local", "peer", peer as never);

    hub.broadcastPersonalTask({
      householdId: "hh-local",
      ownerMembershipId: "owner",
      visibility: "private",
      taskId: "task-private",
      at: "2026-09-29T12:00:00.000Z",
    });
    expect(owner.sent).toHaveLength(1);
    expect(JSON.parse(owner.sent[0]!).resourceId).toBe("task-private");
    expect(peer.sent).toHaveLength(0);

    owner.sent = [];
    peer.sent = [];
    hub.broadcastPersonalTask({
      householdId: "hh-local",
      ownerMembershipId: "owner",
      visibility: "private",
      taskId: "task-was-household",
      at: "2026-09-29T12:01:00.000Z",
      previouslyHouseholdVisible: true,
    });
    expect(JSON.parse(owner.sent[0]!).resourceId).toBe("task-was-household");
    expect(peer.sent).toHaveLength(1);
    expect(JSON.parse(peer.sent[0]!).resourceId).toBe("");
    expect(JSON.stringify(peer.sent[0]!)).not.toContain("task-was-household");
  });
});
