import type { WebSocket } from "@fastify/websocket";
import type { SyncNotification } from "../shared/schemas.js";

type Client = {
  socket: WebSocket;
  householdId: string;
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
    const client: Client = { householdId, socket };
    this.clients.add(client);
    socket.on("close", () => this.clients.delete(client));
  }

  broadcast(notification: SyncNotification): void {
    const payload = JSON.stringify(notification);
    for (const client of this.clients) {
      if (client.householdId !== notification.householdId) continue;
      if (client.socket.readyState === 1) {
        client.socket.send(payload);
      }
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
