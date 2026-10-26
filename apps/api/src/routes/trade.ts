import type { FastifyInstance } from "fastify";
import { ClaimBuildRequestSchema, TradeBuildRequestSchema, type TradeBuildResponse } from "@divvy/shared";
import { sendError } from "../errors";
import { SOL_USD } from "../mock/data";
import { amount, type MockStore } from "../mock/store";
import type { SessionLookup } from "./auth";

/**
 * Trade and claim builders. In mock mode they return quotes in the real shape with `tx: null`;
 * Phase 3 builds the transactions (LaunchLab SDK on the curve, Jupiter after graduation).
 */
export async function tradeRoutes(app: FastifyInstance, { store, session }: { store: MockStore; session: SessionLookup }) {
  app.post("/api/trade/build", async (req, reply): Promise<TradeBuildResponse | void> => {
    const body = TradeBuildRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "That trade request isn't valid");
    const c = store.coinByMint(body.data.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const price = c.mcap / 1e9;
    const keep = 1 - body.data.slippageBps / 10_000;
    if (body.data.side === "buy") {
      const v = Number(body.data.amountIn) / 1e9;
      const impact = Math.min(0.25, v / 40);
      const out = ((v * SOL_USD * 0.99) / price) * (1 - impact);
      return { tx: null, route: c.graduated ? "jupiter" : "curve", expectedOut: amount(out, 6), minOut: amount(out * keep, 6), priceImpactBps: Math.round(impact * 10_000) };
    }
    const tokens = Number(body.data.amountIn) / 1e6;
    const out = (tokens * price * 0.99) / SOL_USD;
    return { tx: null, route: c.graduated ? "jupiter" : "curve", expectedOut: amount(out, 9), minOut: amount(out * keep, 9), priceImpactBps: 0 };
  });

  app.get("/api/claims", async (req, reply) => {
    if (!session(req)) return sendError(reply, 401, "SIGN_IN", "Sign in with your wallet first");
    return { delivery: "push", items: [] };
  });

  app.post("/api/claims/build", async (req, reply) => {
    if (!session(req)) return sendError(reply, 401, "SIGN_IN", "Sign in with your wallet first");
    const body = ClaimBuildRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Pick an asset to claim");
    return sendError(reply, 409, "NOTHING_TO_CLAIM", "There's nothing to claim yet");
  });
}
