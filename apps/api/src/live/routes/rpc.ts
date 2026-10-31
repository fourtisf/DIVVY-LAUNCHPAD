/**
 * POST /api/rpc: the browser's Solana RPC.
 *
 * The public mainnet RPC refuses or rate-limits requests from websites, and the server's Helius key must
 * never reach a browser. So the site sends its few RPC calls here (NEXT_PUBLIC_SOLANA_RPC_URL=/api/rpc)
 * and the API forwards them to its own RPC (RPC_RELAY_URL, else SOLANA_RPC_URL). Only the methods the
 * site and the wallet adapters use pass, only from the site's own pages, and token accounts only by
 * mint: this is not an open relay.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../errors";
import type { LiveDeps } from "../deps";
import { BRAND } from "@divvy/shared";

const ALLOWED = new Set([
  "getLatestBlockhash", // lib/tx.ts, and wallets that send through the page's connection
  "sendTransaction",
  "getSignatureStatuses", // confirmation, by polling (lib/tx.ts)
  "getBlockHeight",
  "getBalance", // the trade box's balances
  "getTokenAccountsByOwner",
]);

/** The largest answer relayed: a page's balance or blockhash is a few hundred bytes. */
const MAX_RESPONSE_BYTES = 256 * 1024;

const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(64), z.number()]),
  method: z.string().max(64),
  params: z.array(z.unknown()).max(4).optional(),
});

/** Reads at most `max` bytes of a body; null if it's longer. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function liveRpcRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  const site = new URL(d.env.WEB_ORIGIN).origin;
  const upstream = d.env.RPC_RELAY_URL ?? d.sol.rpcUrl;
  app.post("/api/rpc", { bodyLimit: 64 * 1024, config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
    // Browsers always send Origin on a POST; a script without it gets nothing (the app-wide check only
    // refuses a wrong one, audit).
    if (req.headers.origin !== site) return sendError(reply, 403, "BAD_ORIGIN", `Requests must come from the ${BRAND} app`);
    const body = RpcRequest.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_RPC_REQUEST", "One JSON-RPC 2.0 request per call");
    if (!ALLOWED.has(body.data.method)) return sendError(reply, 403, "RPC_METHOD_NOT_ALLOWED", `${body.data.method} isn't available here`);
    // A wallet's balance of one coin (TradeBox), not every token account it has.
    const filter = body.data.params?.[1] as { mint?: unknown } | undefined;
    if (body.data.method === "getTokenAccountsByOwner" && typeof filter?.mint !== "string") {
      return sendError(reply, 403, "RPC_METHOD_NOT_ALLOWED", "getTokenAccountsByOwner needs a mint filter here");
    }
    let res: Response;
    let text: string | null;
    try {
      res = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body.data),
        signal: AbortSignal.timeout(15_000),
      });
      text = await readCapped(res, MAX_RESPONSE_BYTES);
    } catch {
      return sendError(reply, 502, "RPC_UNAVAILABLE", "Solana's RPC didn't answer. Try again.");
    }
    req.log.info({ rpcMethod: body.data.method, status: res.status }, "rpc relay");
    if (text === null) return sendError(reply, 502, "RPC_RESPONSE_TOO_LARGE", "That answer is too large to relay");
    return reply.code(res.status).header("cache-control", "no-store").type("application/json").send(text);
  });
}
