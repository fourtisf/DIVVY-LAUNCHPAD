/**
 * POST /api/rpc: the browser's Solana RPC.
 *
 * The public mainnet RPC refuses or rate-limits requests from websites, and the server's Helius key must
 * never reach a browser. So the site sends its few RPC calls here (NEXT_PUBLIC_SOLANA_RPC_URL=/api/rpc)
 * and the API forwards them to its own RPC. Only the methods the site and the wallet adapters use pass:
 * this is not an open relay.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendError } from "../../errors";
import type { LiveDeps } from "../deps";

const ALLOWED = new Set([
  "getLatestBlockhash", // lib/tx.ts, and wallets that send through the page's connection
  "sendTransaction",
  "getSignatureStatuses", // confirmation, by polling (lib/tx.ts)
  "getBlockHeight",
  "getBalance", // the trade box's balances
  "getTokenAccountsByOwner",
]);

const RpcRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(64), z.number()]),
  method: z.string().max(64),
  params: z.array(z.unknown()).max(4).optional(),
});

export async function liveRpcRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  app.post("/api/rpc", { bodyLimit: 64 * 1024, config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = RpcRequest.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_RPC_REQUEST", "One JSON-RPC 2.0 request per call");
    if (!ALLOWED.has(body.data.method)) return sendError(reply, 403, "RPC_METHOD_NOT_ALLOWED", `${body.data.method} isn't available here`);
    let res: Response;
    try {
      res = await fetch(d.sol.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body.data),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return sendError(reply, 502, "RPC_UNAVAILABLE", "Solana's RPC didn't answer. Try again.");
    }
    req.log.info({ rpcMethod: body.data.method, status: res.status }, "rpc relay");
    return reply
      .code(res.status)
      .header("cache-control", "no-store")
      .type("application/json")
      .send(await res.text());
  });
}
