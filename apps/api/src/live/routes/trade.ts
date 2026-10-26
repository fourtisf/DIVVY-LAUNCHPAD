import type { FastifyInstance } from "fastify";
import BN from "bn.js";
import { z } from "zod";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  ClaimBuildRequestSchema,
  ReportRequestSchema,
  TradeBuildRequestSchema,
  type ClaimJobResult,
  type CreatorInfo,
  type MyPayouts,
  type TradeBuildResponse,
} from "@divvy/shared";
import {
  buyInstructions,
  claimCreatorFeeInstructions,
  creatorFeeVault,
  decodePool,
  feeRates,
  poolPriceSol,
  POOL_STATUS,
  quoteBuy,
  quoteSell,
  sellInstructions,
  swapTransaction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@divvy/solana/live";
import { WSOL_MINT } from "@divvy/solana";
import { sendError } from "../../errors";
import type { LiveDeps } from "../deps";
import { amount, coinByMint } from "../data";
import { getViewer, refuseBlockedCountry, requireViewer } from "../viewer";

const MAX_BUY_LAMPORTS = 1_000n * 1_000_000_000n;
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

export async function liveTradeRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  app.post("/api/trade/build", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply): Promise<TradeBuildResponse | void> => {
    const body = TradeBuildRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "That trade request isn't valid");
    const { side, slippageBps } = body.data;
    const amountIn = BigInt(body.data.amountIn);
    if (amountIn <= 0n || (side === "buy" && amountIn > MAX_BUY_LAMPORTS)) return sendError(reply, 422, "BAD_AMOUNT", "Enter an amount");
    const c = await coinByMint(d, body.data.mint);
    if (!c || !c.poolState) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const owner = new PublicKey(body.data.wallet);
    const mint = new PublicKey(c.mint!);
    const keep = (x: bigint) => (x * BigInt(10_000 - slippageBps)) / 10_000n;
    const { blockhash } = await d.conn.getLatestBlockhash("confirmed");

    const poolInfo = await d.conn.getAccountInfo(new PublicKey(c.poolState));
    const pool = poolInfo ? decodePool(poolInfo.data) : null;
    const onCurve = c.status === "live" && pool && pool.status !== POOL_STATUS.trade;

    if (onCurve && pool) {
      const { global, platform } = await d.chain();
      const rates = feeRates(global, platform);
      const mintProgramA = pool.mintProgramFlag & 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
      const base = { programId: d.programs.launchLab, owner, poolId: new PublicKey(c.poolState), pool, mintProgramA };
      const spot = poolPriceSol(pool);
      if (side === "buy") {
        const q = quoteBuy(pool, global, rates, new BN(amountIn.toString()));
        const out = BigInt(q.amountOut.toString());
        if (out <= 0n) return sendError(reply, 422, "CURVE_FULL", "The curve is complete; this coin is graduating");
        const ixs = buyInstructions({ ...base, lamportsIn: new BN(q.amountIn.toString()), minTokensOut: new BN(keep(out).toString()) });
        const exec = Number(amountIn) / 1e9 / (Number(out) / 1e6);
        const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
        return { tx: b64(tx), route: "curve", expectedOut: amount(out, 6), minOut: amount(keep(out), 6), priceImpactBps: spot > 0 ? Math.max(0, Math.round((exec / spot - 1) * 10_000)) : 0 };
      }
      const q = quoteSell(pool, global, rates, new BN(amountIn.toString()));
      const out = BigInt(q.amountOut.toString());
      const ixs = sellInstructions({ ...base, tokensIn: new BN(amountIn.toString()), minLamportsOut: new BN(keep(out).toString()) });
      const exec = Number(out) / 1e9 / (Number(amountIn) / 1e6);
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
      return { tx: b64(tx), route: "curve", expectedOut: amount(out, 9), minOut: amount(keep(out), 9), priceImpactBps: spot > 0 ? Math.max(0, Math.round((1 - exec / spot) * 10_000)) : 0 };
    }

    // Graduated: Jupiter routes into the CPMM pool. The user lands it from their wallet.
    const built = await d.jupiter
      .build({ inputMint: side === "buy" ? WSOL_MINT : mint.toBase58(), outputMint: side === "buy" ? mint.toBase58() : WSOL_MINT, amount: amountIn, taker: owner, slippageBps })
      .catch(() => null);
    if (!built) return sendError(reply, 502, "NO_ROUTE", "No route for this trade right now. Try again in a moment.");
    const tx = swapTransaction(owner, built, blockhash);
    return { tx: b64(tx), route: "jupiter", expectedOut: amount(built.outAmount, side === "buy" ? 6 : 9), minOut: amount(built.minOut, side === "buy" ? 6 : 9), priceImpactBps: built.priceImpactBps };
  });

  /* ---------- holder claims (claim delivery model) ---------- */

  app.get("/api/claims", async (req, reply) => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    const [credits, prices] = await Promise.all([d.prisma.credit.findMany({ where: { wallet: v.wallet, amount: { gt: 0n } }, include: { asset: true } }), d.prices()]);
    return {
      delivery: d.params.delivery,
      items: credits.map((c) => {
        const a = amount(c.amount, c.asset.decimals);
        return { assetSymbol: c.asset.symbol, mint: c.asset.mint, amount: a, usd: a.ui * (prices.byMint[c.asset.mint] ?? 0) };
      }),
    };
  });

  app.post("/api/claims/build", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    if (await refuseBlockedCountry(d, req, reply)) return;
    if (d.params.delivery !== "claim") return sendError(reply, 409, "PUSH_DELIVERY", "Payouts are sent automatically; there's nothing to claim");
    const body = ClaimBuildRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Pick an asset to claim");
    const asset = await d.prisma.dividendAsset.findUnique({ where: { symbol: body.data.assetSymbol } });
    if (!asset) return sendError(reply, 404, "ASSET_UNKNOWN", "Unknown asset");
    // The payout vault key lives only in the worker; it partially signs and reserves the amount.
    const job = await d.queues.claims.add("build", { wallet: v.wallet, assetId: asset.id }, { removeOnComplete: 100, removeOnFail: 100 });
    const r = (await job.waitUntilFinished(d.claimEvents, 20_000).catch(() => null)) as ClaimJobResult | null;
    if (!r) return sendError(reply, 504, "CLAIM_TIMEOUT", "Building the claim took too long. Try again.");
    if (r.error || !r.tx) return sendError(reply, 409, r.error?.code ?? "NOTHING_TO_CLAIM", r.error?.message ?? "There's nothing to claim yet");
    return { tx: r.tx };
  });

  /* ---------- my payouts, creator fees, reports ---------- */

  app.get("/api/me/payouts", async (req, reply): Promise<MyPayouts | void> => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    const q = z.object({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const rows = await d.prisma.payoutItem.findMany({
      where: { wallet: v.wallet, round: { dryRun: false }, ...(q.cursor ? { createdAt: { lt: new Date(q.cursor) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      include: { round: { include: { coin: { include: { dividendAsset: true } } } } },
    });
    const more = rows.length > q.limit;
    return {
      items: rows.slice(0, q.limit).map((i) => {
        const a = i.round.coin.dividendAsset;
        const am = amount(i.amountAsset, a.decimals);
        return {
          coin: { mint: i.round.coin.mint!, ticker: i.round.coin.ticker, imageUrl: i.round.coin.imageUrl },
          hour: i.round.hour.toISOString(),
          assetSymbol: a.symbol,
          amount: am,
          usd: am.ui * Number(i.round.priceUsd ?? 0),
          status: i.status,
          sig: i.sendSig,
        };
      }),
      nextCursor: more ? rows[q.limit - 1]!.createdAt.toISOString() : null,
    };
  });

  app.get("/api/me/creator", async (req, reply): Promise<CreatorInfo | void> => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    const owner = new PublicKey(v.wallet);
    const [coins, vault] = await Promise.all([
      d.prisma.coin.findMany({ where: { creatorWallet: v.wallet, status: { not: "failed" } }, orderBy: { createdAt: "desc" } }),
      d.conn.getTokenAccountBalance(creatorFeeVault(d.programs.launchLab, owner)).catch(() => null),
    ]);
    const fees = await d.prisma.trade.groupBy({ by: ["coinId"], where: { coinId: { in: coins.map((c) => c.id) } }, _sum: { creatorFee: true } });
    const byCoin = new Map(fees.map((f) => [f.coinId, f._sum.creatorFee ?? 0n]));
    return {
      wallet: v.wallet,
      claimable: amount(vault?.value.amount ?? "0", 9),
      coins: coins
        .filter((c) => c.mint && c.status !== "pending")
        .map((c) => ({ mint: c.mint!, ticker: c.ticker, imageUrl: c.imageUrl, name: c.name, status: c.status, creatorFees: amount(byCoin.get(c.id) ?? 0n, 9) })),
    };
  });

  app.post("/api/me/creator/claim/build", async (req, reply) => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    const owner = new PublicKey(v.wallet);
    const bal = await d.conn.getTokenAccountBalance(creatorFeeVault(d.programs.launchLab, owner)).catch(() => null);
    if (!bal || BigInt(bal.value.amount) === 0n) return sendError(reply, 409, "NOTHING_TO_CLAIM", "There's nothing to claim yet");
    const { blockhash } = await d.conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: claimCreatorFeeInstructions(d.programs.launchLab, owner) }).compileToV0Message();
    return { tx: b64(new VersionedTransaction(msg)) };
  });

  app.post<{ Params: { mint: string } }>("/api/coins/:mint/report", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = ReportRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Pick a reason");
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const v = await getViewer(d, req);
    await d.prisma.report.create({ data: { coinId: c.id, reporterUserId: v?.userId ?? null, reason: body.data.reason, details: body.data.details } });
    return reply.code(201).send({ ok: true });
  });
}
