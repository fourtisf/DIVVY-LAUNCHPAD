import type { FastifyInstance } from "fastify";
import type { LiveEvent } from "@divvy/shared";
import { subscribeLive } from "@divvy/server";
import type { LiveDeps } from "../deps";
import { invalidateBoard } from "../data";

/** WS /api/live: relays events the worker publishes on Redis to every connected browser. */
export async function liveWsRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  const sockets = new Set<{ send: (s: string) => void; readyState: number; OPEN: number }>();
  const stop = subscribeLive(d.env.REDIS_URL!, (e: LiveEvent) => {
    if (e.type === "launch" || e.type === "graduate") invalidateBoard();
    const msg = JSON.stringify(e);
    for (const s of sockets) if (s.readyState === s.OPEN) s.send(msg);
  });
  app.addHook("onClose", async () => stop());

  app.get("/api/live", { websocket: true }, (socket) => {
    sockets.add(socket);
    const ping = setInterval(() => socket.readyState === socket.OPEN && socket.ping(), 25_000);
    socket.on("close", () => {
      clearInterval(ping);
      sockets.delete(socket);
    });
  });
}
