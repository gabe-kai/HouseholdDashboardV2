import type { WebSocket } from "@fastify/websocket";
import type { SyncNotification } from "../shared/schemas.js";

type Client = {
  socket: WebSocket;
  householdId: string;
};

export class SyncHub {
  private clients = new Set<Client>();

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
}
