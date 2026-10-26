import type { FastifyInstance } from "fastify";
import type { LiveEvent } from "@divvy/shared";
import type { MockStore } from "../mock/store";

/** WS /api/live: launch, trade, graduate, payout_round and meter_status events as JSON frames. */
export async function liveRoutes(app: FastifyInstance, { store }: { store: MockStore }) {
  app.get("/api/live", { websocket: true }, (socket) => {
    const send = (e: LiveEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e));
    };
    store.listeners.add(send);
    // Keep idle proxies from closing the socket.
    const ping = setInterval(() => socket.readyState === socket.OPEN && socket.ping(), 25_000);
    socket.on("close", () => {
      clearInterval(ping);
      store.listeners.delete(send);
    });
  });

  // Mock launches advance on reads; this also lets idle WS clients hear about them.
  const t = setInterval(() => store.tick(), 500);
  app.addHook("onClose", async () => clearInterval(t));
}
