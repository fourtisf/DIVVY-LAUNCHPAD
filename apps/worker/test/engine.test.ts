/**
 * Dividend engine against real Postgres ("<db>_wtest") and Redis, with the chain stubbed.
 * HANDOFF §11 Phase 4: "dry-run rounds match manual calculations for 3 coins". Every expected
 * number below is worked out by hand in the comments.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { MintLayout, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PrismaClient } from "@divvy/db";
import { foldName, foldTicker, loadParams, type DivvyParams } from "@divvy/shared";
import { prismaTxLogger, type PriceCache } from "@divvy/server";
import { ata, programs, type MintInfo } from "@divvy/solana/live";
import type { WorkerDeps } from "../src/deps";
import { loadWorkerEnv } from "../src/env";
import { buildClaim, reconcileClaims } from "../src/claims";
import type { OnSigned, PayoutChain } from "../src/payouts/chain";
import { holdersForRound, runPayouts, timing } from "../src/payouts/engine";
import { deliverCredits, settleTransfers } from "../src/payouts/deliver";
import { refreshHolderCounts } from "../src/payouts/holdercount";

const BASE_DB = process.env.DATABASE_URL;
const REDIS = process.env.REDIS_URL;
const run = !!(BASE_DB && REDIS);
const DB = BASE_DB ? BASE_DB.replace(/\/([^/?]+)(\?|$)/, "/$1_wtest$2") : "";

const pk = () => Keypair.generate().publicKey.toBase58();
const W = { alice: pk(), bob: pk(), carol: pk(), dave: pk(), erin: pk(), curveAuth: pk() };
const NVDA = pk();
const SPY = pk();
const USD: Record<string, number> = { [NVDA]: 180, [SPY]: 600 };
const HOUR = new Date("2026-10-26T10:00:00Z");

let prisma: PrismaClient;
let redis: Redis;
const alerts: string[] = [];
const sent: string[] = [];
let statuses: ({ confirmationStatus: string; err: null } | null)[] = [];
let coins: Record<"A" | "B" | "C" | "D", string>;

/** 82-byte Token-2022 mint with no extensions, enough for getMintInfo. */
function mintAccount(decimals: number) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  return { data, owner: TOKEN_2022_PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 };
}

const payoutVault = Keypair.generate();
const feeClaimer = Keypair.generate();
const launcher = Keypair.generate();
// Only alice already holds an NVDAx token account.
const existing = new Set([ata(new PublicKey(W.alice), new PublicKey(NVDA), TOKEN_2022_PROGRAM_ID).toBase58()]);

const conn = {
  rpcEndpoint: "https://rpc.invalid",
  getAccountInfo: async (k: PublicKey) => (k.toBase58() === NVDA || k.toBase58() === SPY ? mintAccount(8) : null),
  getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => (existing.has(k.toBase58()) ? mintAccount(8) : null)),
  getTokenAccountBalance: async () => ({ value: { amount: "100000000000", decimals: 8, uiAmount: 1000 } }),
  getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1000 }),
  getBlockHeight: async () => 5000,
  sendRawTransaction: async () => "x",
  confirmTransaction: async () => ({ value: { err: null } }),
  getSignatureStatuses: async () => ({ value: statuses }),
  getBalance: async () => 10_000_000_000,
  // Rent-exempt minimum: (128 + bytes) × 6,960 lamports.
  getMinimumBalanceForRentExemption: async (len: number) => (128 + len) * 6_960,
} as unknown as Connection;

/** Quote: lamports → USD at $150/SOL → asset at its USD price, minus 0.5% impact. */
const quoteOut = (mint: string, lamports: bigint) => (lamports * 150n * 100_000_000n * 995n) / (1_000_000_000n * BigInt(USD[mint]!) * 1000n);

const HOLDERS: Record<string, { owner: string; amount: bigint }[]> = {};

function stubChain(claimed: bigint): PayoutChain {
  return {
    ratesMismatch: async () => null,
    vaultBalance: async () => claimed,
    claimVault: async (onSigned) => {
      await onSigned("CLAIMSIG");
      return { sig: "CLAIMSIG", lamports: claimed, slot: 100n };
    },
    outcome: async () => ({ status: "unknown" }),
    indexedSlot: async () => 101n,
    finalizedSlot: async () => 10_000n,
    signatureStatuses: async (sigs) => sigs.map(() => "finalized" as const),
    mintInfo: async (m) => ({ address: new PublicKey(m), paused: false, transferHookProgram: null }) as unknown as MintInfo,
    quote: async (m, l) => ({ outAmount: quoteOut(m, l), minOut: 0n, priceImpactBps: 50 }),
    swap: async (m, l, _s, _guard, onSigned) => {
      await onSigned(`SWAP-${m.slice(0, 6)}`);
      return { sig: `SWAP-${m.slice(0, 6)}`, assetOut: quoteOut(m, l) };
    },
    holders: async (mint) => HOLDERS[mint] ?? [],
    excludedOwners: () => new Map([[W.curveAuth, "curve" as const]]),
    cpmmCreatorFees: async () => 0n,
    collectCpmmCreatorFees: async () => null,
    feeKeysByPool: async () => new Map(),
    harvestLockedLp: async () => null,
    memecoinBalance: async () => 0n,
    sellMemecoin: async () => null,
    sendSol: async () => {
      throw new Error("not expected");
    },
    feeClaimerLamports: async () => 10_000_000_000n,
  };
}

function deps(params: DivvyParams, envOverrides: Record<string, string> = {}): WorkerDeps {
  const env = loadWorkerEnv({ REDIS_URL: REDIS, DATABASE_URL: DB, ...envOverrides });
  const p = programs("devnet");
  return {
    env,
    params,
    prisma,
    redis,
    storage: { driver: "local", put: async () => "" },
    sol: { cluster: "devnet", mainnetEnabled: false, rpcUrl: "https://rpc.invalid", platformConfig: Keypair.generate().publicKey, globalConfig: p.defaultGlobalConfig, jitoUrl: "", jitoTipLamports: 1000, jupBaseUrl: "" },
    conn,
    jito: {} as WorkerDeps["jito"],
    jupiter: {} as WorkerDeps["jupiter"],
    programs: p,
    alerts: { send: async (_k, _s, text) => void alerts.push(text) },
    log: () => {},
    txlog: async (e) => {
      sent.push(e.purpose);
      await prismaTxLogger(prisma)(e);
    },
    wallets: { launcher: () => launcher, payoutVault: () => payoutVault, feeClaimer: () => feeClaimer },
    chain: async () => {
      throw new Error("not used");
    },
    prices: async (): Promise<PriceCache> => ({ solUsd: 150, byMint: USD, change24h: {}, at: Date.now() }),
    close: async () => {},
  };
}

async function seed() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  const asset = (symbol: string, mint: string) =>
    prisma.dividendAsset.create({ data: { symbol, name: symbol, kind: "stock", mint, decimals: 8, tokenProgram: "token_2022", mono: symbol.slice(0, 2), chipBg: "#000", chipFg: "#fff", source: "test", fetchedAt: new Date() } });
  const nvda = await asset("NVDAx", NVDA);
  const spy = await asset("SPYx", SPY);
  const user = await prisma.user.create({ data: { wallet: pk() } });
  const coin = async (ticker: string, assetId: string) => {
    const mint = pk();
    const c = await prisma.coin.create({
      data: {
        mint, ticker, tickerNorm: foldTicker(ticker), name: ticker, nameNorm: foldName(ticker), imageUrl: "x", imageSha256: ticker, imagePhash: "0",
        dividendAssetId: assetId, creatorUserId: user.id, creatorWallet: user.wallet, poolState: pk(), status: "live", launchedAt: new Date(),
        // 1e-7 SOL per token at $150/SOL = $0.000015 per token; MIN_HOLDER_USD $10 = 666,667 tokens.
        stats: { create: { priceSol: "0.0000001" } },
      },
    });
    return { id: c.id, mint };
  };
  const A = await coin("AAA", nvda.id);
  const B = await coin("BBB", nvda.id);
  const C = await coin("CCC", spy.id);
  const D = await coin("DDD", nvda.id);
  coins = { A: A.id, B: B.id, C: C.id, D: D.id };

  // Platform fees: A 0.12 SOL over two trades, B 0.06, C 0.09, D 0.003.
  let slot = 10n;
  const trade = (coinId: string, platformFee: bigint) =>
    prisma.trade.create({ data: { sig: `s${slot}`, ix: 0, coinId, side: "buy", solAmount: platformFee * 166n, tokenAmount: 1n, wallet: W.alice, priceSol: "0.0000001", platformFee, slot: slot++, ts: new Date(HOUR.getTime() - 600_000) } });
  await trade(A.id, 80_000_000n);
  await trade(A.id, 40_000_000n);
  await trade(B.id, 60_000_000n);
  await trade(C.id, 90_000_000n);
  await trade(D.id, 3_000_000n);

  const t = (n: number) => BigInt(n) * 1_000_000n; // whole tokens → base units (6 decimals)
  HOLDERS[A.mint] = [
    { owner: W.curveAuth, amount: t(500_000_000) }, // excluded: curve vault owner
    { owner: W.alice, amount: t(3_000_000) }, // $45
    { owner: W.bob, amount: t(1_000_000) }, // $15
    { owner: W.carol, amount: t(500_000) }, // $7.50 → under $10, excluded as small
  ];
  HOLDERS[B.mint] = [{ owner: W.dave, amount: t(2_000_000) }];
  HOLDERS[C.mint] = [
    { owner: W.alice, amount: t(1_000_000) },
    { owner: W.erin, amount: t(1_000_000) },
  ];
}

const items = async (dryRun: boolean) =>
  Object.fromEntries(
    (await prisma.payoutItem.findMany({ where: { round: { dryRun } }, include: { round: { include: { coin: true } } } })).map((i) => [`${i.round.coin.ticker}:${Object.entries(W).find(([, v]) => v === i.wallet)![0]}`, i.amountAsset]),
  );

describe.skipIf(!run)("dividend engine", () => {
  beforeAll(async () => {
    execSync("./node_modules/.bin/prisma migrate deploy", { cwd: join(__dirname, "../../../packages/db"), env: { ...process.env, DATABASE_URL: DB }, stdio: "ignore" });
    prisma = new PrismaClient({ datasources: { db: { url: DB } } });
    redis = new Redis(REDIS!);
    await redis.del(...(await redis.keys("divvy:alert:*")).concat("divvy:none"));
    await seed();
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await redis?.quit();
  });

  it("dry-run: matches the hand calculation for 3 paying coins and carries the 4th", async () => {
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "true" }));
    // Simulated claim = indexed fees = 0.273 SOL.
    const s = await runPayouts(d, stubChain(0n), HOUR, true, () => new Date(HOUR.getTime() + 5 * 60_000));
    expect(s).toMatchObject({ claimedLamports: "273000000", unattributedLamports: "0", rounds: { ok: 3, carried: 1 } });

    // 0.60% platform fee = 0.50% holders + 0.10% Divvy → 5/6 and 1/6.
    const alloc = Object.fromEntries((await prisma.feeAllocation.findMany({ where: { dryRun: true } })).map((a) => [a.coinId, [a.holdersLamports, a.divvyLamports]]));
    expect(alloc[coins.A]).toEqual([100_000_000n, 20_000_000n]);
    expect(alloc[coins.B]).toEqual([50_000_000n, 10_000_000n]);
    expect(alloc[coins.C]).toEqual([75_000_000n, 15_000_000n]);
    expect(alloc[coins.D]).toEqual([2_500_000n, 500_000n]);

    const rounds = Object.fromEntries((await prisma.payoutRound.findMany({ where: { dryRun: true } })).map((r) => [r.coinId, r]));
    // D: 0.0025 SOL × $150 = $0.375 < MIN_ROUND_USD $5 → carried, allocation stays unattached.
    expect(rounds[coins.D]).toMatchObject({ status: "carried", carriedOutLamports: 2_500_000n, solIn: 0n });
    // NVDAx batch: 0.15 SOL × 150 / 180 × 0.995 = 0.124375 NVDAx = 12,437,500 units.
    // A:B = 100:50 → 8,291,666.67 / 4,145,833.33 → floors 8,291,666 + 4,145,833, dust 1 to A.
    expect(rounds[coins.A]).toMatchObject({ status: "ok", step: "delivered", solIn: 100_000_000n, assetOut: 8_291_667n, holdersPaid: 2, dustCarried: 1n });
    expect(rounds[coins.B]).toMatchObject({ assetOut: 4_145_833n, holdersPaid: 1, dustCarried: 0n });
    // SPYx: 0.075 SOL × 150 / 600 × 0.995 = 0.01865625 = 1,865,625 units, all to C.
    expect(rounds[coins.C]).toMatchObject({ assetOut: 1_865_625n, holdersPaid: 2, dustCarried: 1n });

    // A: alice 3M, bob 1M eligible (carol is under $10) → 8,291,667 × 3/4 = 6,218,750.25, × 1/4 = 2,072,916.75.
    // C: alice and erin 1M each → 932,812.5 each.
    expect(await items(true)).toEqual({
      "AAA:alice": 6_218_750n,
      "AAA:bob": 2_072_916n,
      "BBB:dave": 4_145_833n,
      "CCC:alice": 932_812n,
      "CCC:erin": 932_812n,
    });
    const snap = await prisma.holderBalance.findMany({ where: { coinId: coins.A } });
    expect(Object.fromEntries(snap.map((h) => [h.wallet, h.excludedReason]))).toEqual({ [W.curveAuth]: "curve", [W.alice]: null, [W.bob]: null, [W.carol]: "small" });

    // Dry-run touches no ledger and signs nothing.
    expect(await prisma.credit.count()).toBe(0);
    expect(await prisma.signedTx.count()).toBe(0);
    expect(sent).toEqual([]);
  });

  it("dry-run is idempotent: a second run for the same hour changes nothing", async () => {
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "true" }));
    const before = await Promise.all([prisma.feeAllocation.count(), prisma.payoutRound.count(), prisma.payoutItem.count(), prisma.swapBatch.count()]);
    await runPayouts(d, stubChain(0n), HOUR, true);
    expect(await Promise.all([prisma.feeAllocation.count(), prisma.payoutRound.count(), prisma.payoutItem.count(), prisma.swapBatch.count()])).toEqual(before);
  });

  it("live: claims, attributes, swaps, credits, auto-sends to existing accounts, and logs every signature", async () => {
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "false", PAYOUT_DELIVERY: "claim" }));
    // The vault paid 1,000 lamports more than the indexed fees: kept unattributed, not given to holders.
    const s = await runPayouts(d, stubChain(273_001_000n), HOUR, false, () => new Date(HOUR.getTime() + 5 * 60_000));
    expect(s).toMatchObject({ claimedLamports: "273001000", unattributedLamports: "1000", rounds: { ok: 3, carried: 1 }, swaps: 2 });
    expect(await items(false)).toEqual(await items(true));

    // alice has an NVDAx account and $11+ of credit → auto-sent; everyone else keeps a credit.
    const credits = Object.fromEntries((await prisma.credit.findMany({ include: { asset: true } })).map((c) => [`${c.asset.symbol}:${Object.entries(W).find(([, v]) => v === c.wallet)![0]}`, c.amount]));
    expect(credits).toEqual({ "NVDAx:alice": 0n, "NVDAx:bob": 2_072_916n, "NVDAx:dave": 4_145_833n, "SPYx:alice": 932_812n, "SPYx:erin": 932_812n });
    const aliceNvda = await prisma.payoutItem.findFirst({ where: { wallet: W.alice, round: { dryRun: false, coinId: coins.A } } });
    expect(aliceNvda?.status).toBe("sent");
    // alice pays her own delivery: the $0.02 fee is 11,112 NVDAx units ($0.02 / $180, rounded up), kept by uspad.
    expect(await prisma.payoutTransfer.findMany({ select: { wallet: true, amount: true, feeAmount: true, status: true } })).toEqual([
      { wallet: W.alice, amount: 6_207_638n, feeAmount: 11_112n, status: "confirmed" },
    ]);
    // The push was logged with its purpose before sending (claim and swap signing is stubbed here).
    expect(sent).toEqual(["payout.send"]);
    expect(await prisma.swapBatch.findMany({ where: { dryRun: false }, select: { status: true } })).toEqual([{ status: "confirmed" }, { status: "confirmed" }]);
    expect((await prisma.vaultClaim.findFirst({ where: { dryRun: false } }))?.sig).toBe("CLAIMSIG");
  });

  it("claims: reserves the credit, then confirms or gives it back", async () => {
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "false", PAYOUT_DELIVERY: "claim" }));
    const nvda = await prisma.dividendAsset.findUniqueOrThrow({ where: { symbol: "NVDAx" } });
    const spy = await prisma.dividendAsset.findUniqueOrThrow({ where: { symbol: "SPYx" } });

    const r = await buildClaim(d, { wallet: W.bob, assetId: nvda.id });
    expect(r.error).toBeUndefined();
    expect(r.amount).toBe("2072916");
    expect(typeof r.tx).toBe("string");
    expect((await buildClaim(d, { wallet: W.bob, assetId: nvda.id })).error?.code).toBe("CLAIM_PENDING");
    expect((await buildClaim(d, { wallet: W.carol, assetId: nvda.id })).error?.code).toBe("NOTHING_TO_CLAIM");
    expect((await prisma.credit.findUniqueOrThrow({ where: { wallet_assetId: { wallet: W.bob, assetId: nvda.id } } })).amount).toBe(0n);

    statuses = [{ confirmationStatus: "confirmed", err: null }];
    await reconcileClaims(d);
    expect((await prisma.claim.findFirstOrThrow({ where: { wallet: W.bob } })).status).toBe("confirmed");
    expect((await prisma.payoutItem.findFirstOrThrow({ where: { wallet: W.bob, round: { dryRun: false } } })).status).toBe("claimed");

    // erin never signs: once the blockhash expires the credit comes back.
    await buildClaim(d, { wallet: W.erin, assetId: spy.id });
    statuses = [null];
    await reconcileClaims(d);
    expect((await prisma.claim.findFirstOrThrow({ where: { wallet: W.erin } })).status).toBe("expired");
    expect((await prisma.credit.findUniqueOrThrow({ where: { wallet_assetId: { wallet: W.erin, assetId: spy.id } } })).amount).toBe(932_812n);
  });

  const addTrade = (fee: bigint, slot: bigint, sig: string) =>
    prisma.trade.create({ data: { sig, ix: 0, coinId: coins.B, side: "buy", solAmount: fee * 166n, tokenAmount: 1n, wallet: W.dave, priceSol: "0.0000001", platformFee: fee, slot, ts: new Date() } });
  /** What the indexer does when it reaches a claim transaction in the PlatformConfig stream. */
  const indexClaim = async (sig: string) => {
    const max = (await prisma.trade.aggregate({ _max: { id: true } }))._max.id!;
    await prisma.vaultClaim.updateMany({ where: { sig }, data: { toTradeId: max } });
  };
  const allocs = async (sig: string) => {
    const c = await prisma.vaultClaim.findFirstOrThrow({ where: { sig } });
    return { claim: c, allocations: (await prisma.feeAllocation.findMany({ where: { vaultClaimId: c.id } })).map((a) => [a.coinId, a.lamports]) };
  };
  const at = (h: number) => new Date(HOUR.getTime() + h * 3_600_000);
  const live = () => deps(loadParams({ PAYOUTS_DRY_RUN: "false", PAYOUT_DELIVERY: "claim" }));

  it("a trade later in the claim's own slot belongs to the next claim, not this one (audit)", async () => {
    timing.pollMs = 1;
    await addTrade(12_000_000n, 300n, "t1");
    const claim2: PayoutChain = {
      ...stubChain(12_000_000n),
      indexedSlot: async () => 301n,
      claimVault: async (onSigned: OnSigned) => {
        await onSigned("CLAIM2");
        await indexClaim("CLAIM2");
        await addTrade(6_000_000n, 300n, "t2"); // same slot, after the claim: its fee is still in the vault
        return { sig: "CLAIM2", lamports: 12_000_000n, slot: 300n };
      },
    };
    await runPayouts(live(), claim2, at(2), false, () => new Date(at(2).getTime() + 300_000));
    const a2 = await allocs("CLAIM2");
    expect(a2.claim.unattributedLamports).toBe(0n);
    expect(a2.allocations).toEqual([[coins.B, 12_000_000n]]);

    const claim3: PayoutChain = {
      ...stubChain(6_000_000n),
      indexedSlot: async () => 302n,
      claimVault: async (onSigned: OnSigned) => {
        await onSigned("CLAIM3");
        await indexClaim("CLAIM3");
        return { sig: "CLAIM3", lamports: 6_000_000n, slot: 301n };
      },
    };
    await runPayouts(live(), claim3, at(3), false, () => new Date(at(3).getTime() + 300_000));
    const a3 = await allocs("CLAIM3");
    expect(a3.claim.unattributedLamports).toBe(0n);
    expect(a3.allocations).toEqual([[coins.B, 6_000_000n]]);
  });

  it("a claim the indexer hadn't reached is attributed before the next claim is made (audit)", async () => {
    await addTrade(9_000_000n, 400n, "t3");
    const behind: PayoutChain = {
      ...stubChain(9_000_000n),
      indexedSlot: async () => 350n,
      claimVault: async (onSigned: OnSigned) => {
        await onSigned("CLAIM4");
        return { sig: "CLAIM4", lamports: 9_000_000n, slot: 400n };
      },
    };
    await expect(runPayouts(live(), behind, at(4), false)).rejects.toThrow("indexer behind");
    expect((await allocs("CLAIM4")).claim.attributedAt).toBeNull();

    // Next hour the indexer is past the claim: the old claim is attributed first, then the new one
    // starts where it ended, so no range overlaps and no claimed lamports are orphaned.
    const caughtUp: PayoutChain = { ...stubChain(0n), indexedSlot: async () => 500n, claimVault: async () => null };
    await runPayouts(live(), caughtUp, at(5), false, () => new Date(at(5).getTime() + 300_000));
    const a4 = await allocs("CLAIM4");
    expect(a4.claim.attributedAt).not.toBeNull();
    expect(a4.allocations).toEqual([[coins.B, 9_000_000n]]);
    const c5 = await prisma.vaultClaim.findUniqueOrThrow({ where: { hour_dryRun: { hour: at(5), dryRun: false } } });
    expect(c5.fromTradeId).toBe(a4.claim.toTradeId);
    expect(c5.toTradeId).toBe(c5.fromTradeId);
  });

  it("a round that turns up after its hour's swap is carried, not given a share it didn't fund (audit)", async () => {
    const h = at(6);
    const nvda = await prisma.dividendAsset.findUniqueOrThrow({ where: { symbol: "NVDAx" } });
    const batch = await prisma.swapBatch.create({ data: { assetId: nvda.id, hour: h, dryRun: true, lamportsIn: 100_000_000n, status: "confirmed", assetOut: 8_000_000n } });
    const funded = await prisma.payoutRound.create({ data: { coinId: coins.A, hour: h, dryRun: true, status: "ok", step: "allocated", solIn: 100_000_000n, swapBatchId: batch.id } });
    const late = await prisma.payoutRound.create({ data: { coinId: coins.B, hour: h, dryRun: true, status: "ok", step: "allocated", solIn: 100_000_000n } });
    await runPayouts(deps(loadParams({ PAYOUTS_DRY_RUN: "true" })), stubChain(0n), h, true, () => new Date(h.getTime() + 300_000), { resumeOnly: true });
    expect(await prisma.payoutRound.findUniqueOrThrow({ where: { id: funded.id } })).toMatchObject({ assetOut: 8_000_000n });
    expect(await prisma.payoutRound.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({ status: "carried", assetOut: 0n, carriedOutLamports: 100_000_000n });
  });

  it("two settlers expiring the same transfer restore the credit once (audit)", async () => {
    const nvda = await prisma.dividendAsset.findUniqueOrThrow({ where: { symbol: "NVDAx" } });
    const before = (await prisma.credit.findUniqueOrThrow({ where: { wallet_assetId: { wallet: W.dave, assetId: nvda.id } } })).amount;
    await prisma.credit.update({ where: { wallet_assetId: { wallet: W.dave, assetId: nvda.id } }, data: { amount: { decrement: 1000n } } });
    await prisma.payoutTransfer.create({ data: { sig: "RACE", wallet: W.dave, assetId: nvda.id, amount: 1000n, lastValidBlockHeight: 1n } });
    const d = live();
    await Promise.all([settleTransfers(d, "RACE", "expired"), settleTransfers(d, "RACE", "expired"), settleTransfers(d, "RACE", "expired")]);
    expect((await prisma.credit.findUniqueOrThrow({ where: { wallet_assetId: { wallet: W.dave, assetId: nvda.id } } })).amount).toBe(before);
  });

  it("pays each wallet on the smaller of its mid-hour and round balances (audit: flash holders)", async () => {
    const h = at(7);
    const mint = (await prisma.coin.findUniqueOrThrow({ where: { id: coins.C } })).mint!;
    const key = `divvy:presnap:${h.toISOString()}:${coins.C}`;
    await redis.hset(key, { _: "0", [W.alice]: (500_000n * 1_000_000n).toString() }); // erin held nothing mid-hour
    const rows = await holdersForRound(deps(loadParams({})), stubChain(0n), coins.C, mint, h);
    await redis.del(key);
    expect(Object.fromEntries(rows.map((r) => [r.owner, r.amount]))).toEqual({ [W.alice]: 500_000n * 1_000_000n, [W.erin]: 0n });
  });

  it("refuses to pay when the on-chain fee rates don't match the configured split", async () => {
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "true" }));
    const chain = { ...stubChain(0n), ratesMismatch: async () => "rates differ" };
    await expect(runPayouts(d, chain, new Date(HOUR.getTime() + 3_600_000), true)).rejects.toThrow("rates differ");
    expect(alerts.some((a) => a.includes("rates differ"))).toBe(true);
  });

  it("pays a backlog over the swap budget in part, carries the rest, and halves the size after an impact refusal (audit)", async () => {
    await seed();
    const base = deps(loadParams({ PAYOUTS_DRY_RUN: "true" }));
    const d = { ...base, env: { ...base.env, SWAP_BATCH_MAX_LAMPORTS: 75_000_000 } };
    await runPayouts(d, stubChain(0n), HOUR, true, () => new Date(HOUR.getTime() + 5 * 60_000));
    const rounds = Object.fromEntries((await prisma.payoutRound.findMany({ where: { dryRun: true, hour: HOUR } })).map((r) => [r.coinId, r]));
    // NVDAx budget 0.075 SOL against 0.1525 waiting (A 0.1, B 0.05, D 0.0025): each coin gets 75/152.5 of its
    // share. A: 49,180,327 ($7.38, a round). B: 24,590,163 ($3.69, under $5) and D carry whole.
    expect(rounds[coins.A]).toMatchObject({ status: "ok", solIn: 49_180_327n, carriedOutLamports: 50_819_673n });
    expect(rounds[coins.B]).toMatchObject({ status: "carried", carriedOutLamports: 50_000_000n });
    expect(rounds[coins.C]).toMatchObject({ status: "ok", solIn: 75_000_000n, carriedOutLamports: 0n });
    // Nothing is lost: A's allocations still add up to its 0.1 SOL; the unspent part waits unattached.
    const a = await prisma.feeAllocation.findMany({ where: { coinId: coins.A, dryRun: true } });
    expect(a.reduce((x, r) => x + r.holdersLamports, 0n)).toBe(100_000_000n);
    expect(a.filter((r) => r.roundId === null).reduce((x, r) => x + r.holdersLamports, 0n)).toBe(50_819_673n);
    expect((await prisma.swapBatch.findFirstOrThrow({ where: { hour: HOUR, dryRun: true, asset: { mint: NVDA } } })).lamportsIn).toBe(49_180_327n);

    // Next hour the route's impact is over the cap: the swap is refused, the rounds carry, and the
    // size limit for that stock halves.
    const next = new Date(HOUR.getTime() + 3_600_000);
    const chain: PayoutChain = { ...stubChain(0n), quote: async (m, l) => ({ outAmount: quoteOut(m, l), minOut: 0n, priceImpactBps: 400 }) };
    await runPayouts(d, chain, next, true, () => new Date(next.getTime() + 5 * 60_000));
    const nb = await prisma.swapBatch.findFirstOrThrow({ where: { hour: next, dryRun: true, asset: { mint: NVDA } } });
    expect(nb.status).toBe("skipped");
    expect(await redis.get(`divvy:swap-limit:dry:${nb.assetId}`)).toBe((nb.lamportsIn / 2n).toString());
    const waiting = await prisma.feeAllocation.aggregate({ where: { dryRun: true, roundId: null, coin: { dividendAsset: { mint: NVDA } } }, _sum: { holdersLamports: true } });
    expect(waiting._sum.holdersLamports).toBe(50_819_673n + 50_000_000n + 2_500_000n);
  });
  it("after graduation: finds the Fee Key, collects, sells the memecoin, splits 50 : 15 : 10 and forwards the creator's share once", async () => {
    const pool = pk();
    const nft = pk();
    await prisma.coin.update({ where: { id: coins.B }, data: { status: "graduated", cpmmPool: pool, graduatedAt: new Date(HOUR.getTime() - 7_200_000) } });
    const creator = (await prisma.coin.findUniqueOrThrow({ where: { id: coins.B } })).creatorWallet;
    let creatorPending = 2_000_000n;
    let lpFees = 15_000_000n;
    let memecoin = 0n;
    const forwards: [string, bigint][] = [];
    const chain: PayoutChain = {
      ...stubChain(0n),
      claimVault: async () => null,
      cpmmCreatorFees: async (p) => (p === pool ? creatorPending : 0n),
      collectCpmmCreatorFees: async (_p, _c, onSigned) => {
        await onSigned("CREATORFEE");
        creatorPending = 0n;
        return { sig: "CREATORFEE", lamports: 7_500_000n };
      },
      feeKeysByPool: async (pools) => new Map(pools.includes(pool) ? [[pool, nft]] : []),
      harvestLockedLp: async (c, simulateOnly, onSigned) => {
        expect([c.feeKeyMint, simulateOnly]).toEqual([nft, false]);
        if (lpFees === 0n) return null;
        await onSigned("LPFEE");
        const r = { sig: "LPFEE", lpFeeAmount: 1_000n, lamports: lpFees, memecoin: 4_000_000n };
        lpFees = 0n;
        memecoin += 4_000_000n;
        return r;
      },
      memecoinBalance: async () => memecoin,
      sellMemecoin: async (_c, amount, onSigned) => {
        await onSigned("SELL");
        memecoin -= amount;
        return { sig: "SELL", sold: amount, lamports: 7_500_000n };
      },
      sendSol: async (to, lamports, purpose, _c, onSigned) => {
        expect(purpose).toBe("fees.forward_creator");
        await onSigned(`FWD-${forwards.length}`);
        forwards.push([to, lamports]);
        return { sig: `FWD-${forwards.length - 1}` };
      },
    };
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "false" }), { CPMM_CREATOR_FEES: "true", LOCKED_LP_FEES: "true", CREATOR_FORWARD_MIN_LAMPORTS: "5000000" });
    const h = new Date(HOUR.getTime() + 3 * 3_600_000);
    await runPayouts(d, chain, h, false, () => new Date(h.getTime() + 300_000));

    expect((await prisma.coin.findUniqueOrThrow({ where: { id: coins.B } })).feeKeyMint).toBe(nft);
    const claims = await prisma.feeClaim.findMany({ where: { coinId: coins.B }, orderBy: { ts: "asc" }, select: { kind: true, lamports: true, memecoinAmount: true } });
    expect(claims).toEqual([
      { kind: "cpmm_creator", lamports: 7_500_000n, memecoinAmount: 0n },
      { kind: "cpmm_locked_lp", lamports: 15_000_000n, memecoinAmount: 4_000_000n },
      { kind: "memecoin_sale", lamports: 7_500_000n, memecoinAmount: 4_000_000n },
    ]);
    // 50 : 15 : 10 of 75: 7.5M → 5M / 1.5M / 1M; 15M → 10M / 3M / 2M.
    const split = await prisma.feeAllocation.findMany({ where: { coinId: coins.B, feeClaimId: { not: null } }, orderBy: { createdAt: "asc" }, select: { holdersLamports: true, creatorLamports: true, divvyLamports: true } });
    expect(split.map((a) => [a.holdersLamports, a.creatorLamports, a.divvyLamports])).toEqual([
      [5_000_000n, 1_500_000n, 1_000_000n],
      [10_000_000n, 3_000_000n, 2_000_000n],
      [5_000_000n, 1_500_000n, 1_000_000n],
    ]);
    // The creator's 1.5M + 3M + 1.5M = 6M ≥ the 5M minimum: forwarded once, and every allocation is linked.
    expect(forwards).toEqual([[creator, 6_000_000n]]);
    expect(await prisma.creatorTransfer.findMany({ select: { lamports: true, status: true, wallet: true } })).toEqual([{ lamports: 6_000_000n, status: "landed", wallet: creator }]);
    expect(await prisma.feeAllocation.count({ where: { creatorLamports: { gt: 0n }, creatorTransferId: null } })).toBe(0);

    // A second run of the same hour collects nothing new and forwards nothing.
    await runPayouts(d, chain, h, false, () => new Date(h.getTime() + 900_000));
    expect(await prisma.feeClaim.count({ where: { coinId: coins.B } })).toBe(3);
    expect(forwards).toHaveLength(1);
  });

  it("a creator forward a crash left unconfirmed is undone when it never landed, then sent again", async () => {
    const fc = await prisma.feeClaim.create({ data: { coinId: coins.B, kind: "cpmm_creator", sig: "CREATORFEE-2", lamports: 75_000_000n } });
    await prisma.feeAllocation.create({ data: { coinId: coins.B, feeClaimId: fc.id, lamports: 75_000_000n, holdersLamports: 50_000_000n, creatorLamports: 15_000_000n, divvyLamports: 10_000_000n } });
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "false" }), { CREATOR_FORWARD_MIN_LAMPORTS: "5000000" });
    const h = new Date(HOUR.getTime() + 4 * 3_600_000);

    // Signed, then the process died before confirming.
    const crashing: PayoutChain = {
      ...stubChain(0n),
      claimVault: async () => null,
      sendSol: async (_to, _l, _p, _c, onSigned) => {
        await onSigned("FWD-LOST");
        throw new Error("crashed after signing");
      },
    };
    await runPayouts(d, crashing, h, false, () => new Date(h.getTime() + 300_000));
    expect(await prisma.creatorTransfer.findUniqueOrThrow({ where: { sig: "FWD-LOST" } })).toMatchObject({ status: "sent", lamports: 15_000_000n });

    // Ten minutes later the chain has never seen it: the share is owed again and goes out once.
    await prisma.creatorTransfer.update({ where: { sig: "FWD-LOST" }, data: { createdAt: new Date(Date.now() - 600_000) } });
    const sentNow: bigint[] = [];
    const recovering: PayoutChain = {
      ...stubChain(0n),
      claimVault: async () => null,
      signatureStatuses: async (sigs) => sigs.map(() => "missing" as const),
      sendSol: async (_to, lamports, _p, _c, onSigned) => {
        await onSigned("FWD-AGAIN");
        sentNow.push(lamports);
        return { sig: "FWD-AGAIN" };
      },
    };
    await runPayouts(d, recovering, h, false, () => new Date(h.getTime() + 900_000));
    expect(await prisma.creatorTransfer.findUnique({ where: { sig: "FWD-LOST" } })).toBeNull();
    expect(sentNow).toEqual([15_000_000n]);
    expect(await prisma.creatorTransfer.findUniqueOrThrow({ where: { sig: "FWD-AGAIN" } })).toMatchObject({ status: "landed", lamports: 15_000_000n });
  });
  it("push: a wallet's first send creates its account and pays the rent and fee from its dividend; an expired send gives it all back", async () => {
    const d = deps(loadParams({ PAYOUTS_DRY_RUN: "false", PAYOUT_DELIVERY: "push" }));
    const nvda = await prisma.dividendAsset.findUniqueOrThrow({ where: { symbol: "NVDAx" } });
    await prisma.credit.updateMany({ where: { assetId: nvda.id }, data: { amount: 0n } });
    await prisma.credit.upsert({ where: { wallet_assetId: { wallet: W.dave, assetId: nvda.id } }, create: { wallet: W.dave, assetId: nvda.id, amount: 5_000_000n }, update: { amount: 5_000_000n } });
    const dave = () => prisma.credit.findUniqueOrThrow({ where: { wallet_assetId: { wallet: W.dave, assetId: nvda.id } } });

    // dave has no NVDAx account and is owed $9 (≥ PUSH_NEW_ATA_MIN_USD $5): the send creates it.
    // A Token-2022 account with ImmutableOwner is 170 bytes → rent 2,074,080 lamports = $0.311112 at
    // SOL $150 = 172,840 NVDAx units; plus the $0.02 fee (11,112) = 183,952 kept from his 5,000,000.
    await deliverCredits(d);
    expect(await prisma.payoutTransfer.findFirstOrThrow({ where: { wallet: W.dave }, orderBy: { createdAt: "desc" }, select: { amount: true, feeAmount: true, createdAta: true, rentLamports: true, status: true } })).toEqual({
      amount: 4_816_048n, feeAmount: 183_952n, createdAta: true, rentLamports: 2_074_080n, status: "confirmed",
    });
    expect((await dave()).amount).toBe(0n);

    // A send whose outcome is unknown stays pending; once expired, the whole debit comes back.
    await prisma.credit.update({ where: { wallet_assetId: { wallet: W.dave, assetId: nvda.id } }, data: { amount: 5_000_000n } });
    const send = (conn as unknown as { sendRawTransaction: () => Promise<string> }).sendRawTransaction;
    (conn as unknown as { sendRawTransaction: () => Promise<string> }).sendRawTransaction = async () => {
      throw new Error("network timeout");
    };
    try {
      await deliverCredits(d);
    } finally {
      (conn as unknown as { sendRawTransaction: () => Promise<string> }).sendRawTransaction = send;
    }
    const pending = await prisma.payoutTransfer.findFirstOrThrow({ where: { wallet: W.dave, status: "pending" } });
    expect((await dave()).amount).toBe(0n);
    await settleTransfers(d, pending.sig, "expired");
    expect((await dave()).amount).toBe(5_000_000n);
  });

  it("counts each coin's holders from the chain for the board, without the curve, in dry-run too", async () => {
    await prisma.coinStats.updateMany({ data: { holders: 0 } });
    const later = new Date(HOUR.getTime() + 30 * 86_400_000);
    expect(await refreshHolderCounts(deps(loadParams({ PAYOUTS_DRY_RUN: "true" })), stubChain(0n), later)).toBeGreaterThanOrEqual(4);
    const holders = Object.fromEntries((await prisma.coinStats.findMany({ include: { coin: true } })).map((s) => [s.coin.ticker, s.holders]));
    // AAA: alice, bob and carol (small holders count too), not the curve vault. DDD has none.
    expect(holders).toMatchObject({ AAA: 3, BBB: 1, CCC: 2, DDD: 0 });
  });
});
