import type { FastifyInstance } from "fastify";
import type { LiveEvent } from "@divvy/shared";
import { subscribeLive } from "@divvy/server";
import type { LiveDeps } from "../deps";
import { invalidateBoard } from "../data";

const MAX_BUFFERED = 1 << 20;

/** WS /api/live: relays events the worker publishes on Redis to every connected browser. */
export async function liveWsRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  const sockets = new Set<{ send: (s: string) => void; readyState: number; OPEN: number; bufferedAmount: number; terminate: () => void }>();
  // Hidden coins (moderation) stay on chain but aren't shown: their events aren't relayed either.
  let hidden = { at: 0, mints: new Set<string>() };
  const refreshHidden = async () => {
    if (Date.now() - hidden.at < 30_000) return;
    const rows = await d.prisma.coin.findMany({ where: { hidden: true, mint: { not: null } }, select: { mint: true } }).catch(() => null);
    if (rows) hidden = { at: Date.now(), mints: new Set(rows.map((r) => r.mint!)) };
  };
  const stop = subscribeLive(d.env.REDIS_URL!, (e: LiveEvent) => {
    void refreshHidden();
    if (e.mint && hidden.mints.has(e.mint)) return;
    if (e.type === "launch" || e.type === "graduate") invalidateBoard();
    const msg = JSON.stringify(e);
    for (const s of sockets) {
      if (s.readyState !== s.OPEN) continue;
      // A client that doesn't read is dropped instead of buffering events in our memory.
      if (s.bufferedAmount > MAX_BUFFERED) s.terminate();
      else s.send(msg);
    }
  });
  app.addHook("onClose", async () => stop());

  app.get("/api/live", { websocket: true }, (socket) => {
    sockets.add(socket);
    // The stream is one-way: any message from the client closes it.
    socket.on("message", () => socket.close(1008, "send-only stream"));
    const ping = setInterval(() => socket.readyState === socket.OPEN && socket.ping(), 25_000);
    socket.on("close", () => {
      clearInterval(ping);
      sockets.delete(socket);
    });
  });
}
