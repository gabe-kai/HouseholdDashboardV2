import type { WebSocket } from "@fastify/websocket";
import type { SyncNotification } from "../shared/schemas.js";

type MemberClient = {
  kind: "member";
  socket: WebSocket;
  householdId: string;
};

type DisplayClient = {
  kind: "display";
  socket: WebSocket;
  householdId: string;
  displayId: string;
  sessionId: string;
};

type Client = MemberClient | DisplayClient;

export type DisplaySyncEvent = {
  type: "display_invalidate";
  householdId: string;
  reason: "work" | "people" | "reset" | "schedule" | "tasks" | "access_lost";
  at: string;
};

const PING_INTERVAL_MS = 25_000;

export class SyncHub {
  private clients = new Set<Client>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.socket.readyState !== 1) continue;
        try {
          client.socket.ping();
        } catch {
          // Dropped sockets are removed on close.
        }
      }
    }, PING_INTERVAL_MS);
    if (typeof this.pingTimer.unref === "function") this.pingTimer.unref();
  }

  add(householdId: string, socket: WebSocket): void {
    const client: MemberClient = { kind: "member", householdId, socket };
    this.clients.add(client);
    socket.on("close", () => this.clients.delete(client));
  }

  addDisplay(
    identity: { householdId: string; displayId: string; sessionId: string },
    socket: WebSocket,
  ): void {
    const client: DisplayClient = {
      kind: "display",
      householdId: identity.householdId,
      displayId: identity.displayId,
      sessionId: identity.sessionId,
      socket,
    };
    this.clients.add(client);
    socket.on("close", () => this.clients.delete(client));
  }

  broadcast(notification: SyncNotification): void {
    const payload = JSON.stringify(notification);
    for (const client of this.clients) {
      if (client.kind !== "member") continue;
      if (client.householdId !== notification.householdId) continue;
      if (client.socket.readyState === 1) {
        client.socket.send(payload);
      }
    }
  }

  /**
   * Sanitized display invalidation — no resource IDs (especially private tasks).
   */
  broadcastDisplay(householdId: string, event: DisplaySyncEvent): void {
    if (event.householdId !== householdId) return;
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.kind !== "display") continue;
      if (client.householdId !== householdId) continue;
      if (client.socket.readyState === 1) {
        client.socket.send(payload);
      }
    }
  }

  closeDisplaySession(sessionId: string): void {
    for (const client of [...this.clients]) {
      if (client.kind !== "display") continue;
      if (client.sessionId !== sessionId) continue;
      try {
        if (client.socket.readyState === 1) {
          client.socket.send(
            JSON.stringify({
              type: "display_invalidate",
              householdId: client.householdId,
              reason: "access_lost",
              at: new Date().toISOString(),
            } satisfies DisplaySyncEvent),
          );
          client.socket.close(4401, "revoked");
        }
      } catch {
        // Ignore already-closed sockets.
      }
      this.clients.delete(client);
    }
  }

  closeDisplay(displayId: string): void {
    for (const client of [...this.clients]) {
      if (client.kind !== "display") continue;
      if (client.displayId !== displayId) continue;
      try {
        if (client.socket.readyState === 1) {
          client.socket.send(
            JSON.stringify({
              type: "display_invalidate",
              householdId: client.householdId,
              reason: "access_lost",
              at: new Date().toISOString(),
            } satisfies DisplaySyncEvent),
          );
          client.socket.close(4401, "revoked");
        }
      } catch {
        // Ignore already-closed sockets.
      }
      this.clients.delete(client);
    }
  }

  close(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const client of this.clients) {
      try {
        client.socket.close();
      } catch {
        // Ignore already-closed sockets.
      }
    }
    this.clients.clear();
  }
}
