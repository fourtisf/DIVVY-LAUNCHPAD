/**
 * Launch pipeline and indexer against real Postgres ("<db>_wtest") and Redis, chain stubbed.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import bs58 from "bs58";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { Keypair, MessageV0, VersionedTransaction, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { PrismaClient } from "@divvy/db";
import { foldName, foldTicker, loadParams } from "@divvy/shared";
import { prismaTxLogger, type PriceCache } from "@divvy/server";
import { EVENT_IX_TAG_LE, POOL_CREATE_EVENT_DISC, programs, TRADE_EVENT_DISC, type PlatformState, type SolanaEnv } from "@divvy/solana/live";
import type { WorkerDeps } from "../src/deps";
import { loadWorkerEnv } from "../src/env";
import { Indexer } from "../src/indexer";
import { failLaunch, processLaunch } from "../src/launch";

const BASE_DB = process.env.DATABASE_URL;
const REDIS = process.env.REDIS_URL;
const run = !!(BASE_DB && REDIS);
const DB = BASE_DB ? BASE_DB.replace(/\/([^/?]+)(\?|$)/, "/$1_wtest$2") : "";
const P = programs("mainnet-beta");

let prisma: PrismaClient;
let redis: Redis;
let rpcSends = 0;
let bundles: string[][] = [];

const conn = {
  rpcEndpoint: "https://rpc.invalid",
  getAccountInfo: async () => null,
  getLatestBlockhash: async () => ({ blockhash: bs58.encode(Buffer.alloc(32, 7)), lastValidBlockHeight: 1000 }),
  sendRawTransaction: async () => {
    rpcSends++;
    return "x";
  },
  confirmTransaction: async () => ({ value: { err: null } }),
  getSignaturesForAddress: async () => [],
} as unknown as Connection;

const tipAccount = Keypair.generate().publicKey;
const jito = {
  randomTipAccount: async () => tipAccount,
  sendBundle: async (txs: string[]) => {
    bundles.push(txs);
    return "bundle-1";
  },
  waitForBundle: async () => ({ bundle_id: "bundle-1", status: "Landed", landed_slot: 1 }),
} as unknown as WorkerDeps["jito"];

function deps(sol: Partial<SolanaEnv>): WorkerDeps {
  return {
    env: loadWorkerEnv({ REDIS_URL: REDIS, DATABASE_URL: DB }),
    params: loadParams({}),
    prisma,
    redis,
    storage: { driver: "local", put: async (key: string) => `https://media.test/${key}` },
    sol: { cluster: "devnet", mainnetEnabled: false, rpcUrl: "", platformConfig: Keypair.generate().publicKey, globalConfig: P.defaultGlobalConfig, jitoUrl: "", jitoTipLamports: 100_000, jupBaseUrl: "", ...sol },
    conn,
    jito,
    jupiter: {} as WorkerDeps["jupiter"],
    programs: P,
    alerts: { send: async () => {} },
    log: () => {},
    txlog: prismaTxLogger(prisma),
    wallets: { launcher: () => launcher, payoutVault: () => Keypair.generate(), feeClaimer: () => Keypair.generate() },
    chain: async () => ({ global: {} as never, platform: { restrictGlobalConfig: 0, restrictCurveParam: 0 } as unknown as PlatformState }),
    prices: async (): Promise<PriceCache> => ({ solUsd: 150, byMint: {}, change24h: {}, at: 0 }),
    close: async () => {},
  };
}

const launcher = Keypair.generate();
let assetId = "";
let userId = "";

async function pendingLaunch(ticker: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const coin = await prisma.coin.create({
    data: {
      ticker, tickerNorm: foldTicker(ticker), name: `${ticker} coin`, nameNorm: foldName(`${ticker} coin`), imageUrl: "https://media.test/x.webp",
      imageSha256: `sha-${ticker}`, imagePhash: "0", dividendAssetId: assetId, creatorUserId: user.id, creatorWallet: user.wallet, creatorXUserId: `x-${ticker}`, status: "pending",
    },
  });
  const launch = await prisma.launch.create({ data: { userId: user.id, coinId: coin.id, request: { name: coin.name, ticker } } });
  return { coin, launch };
}

describe.skipIf(!run)("launch pipeline", () => {
  beforeAll(async () => {
    execSync("./node_modules/.bin/prisma migrate deploy", { cwd: join(__dirname, "../../../packages/db"), env: { ...process.env, DATABASE_URL: DB }, stdio: "ignore" });
    prisma = new PrismaClient({ datasources: { db: { url: DB } } });
    redis = new Redis(REDIS!);
  });
  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    await redis.del(...(await redis.keys("divvy:launcher-spend:*")).concat("divvy:none"));
    const a = await prisma.dividendAsset.create({ data: { symbol: "NVDAx", name: "NVDAx", kind: "stock", mint: Keypair.generate().publicKey.toBase58(), decimals: 8, tokenProgram: "token_2022", mono: "NV", chipBg: "#000", chipFg: "#fff", source: "test", fetchedAt: new Date() } });
    assetId = a.id;
    userId = (await prisma.user.create({ data: { wallet: Keypair.generate().publicKey.toBase58() } })).id;
    rpcSends = 0;
    bundles = [];
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await redis?.quit();
  });

  it("mainnet: sends the create only as a Jito bundle with the tip inside, never through the RPC", async () => {
    const { coin, launch } = await pendingLaunch("JITO");
    const generated: Keypair[] = [];
    const real = Keypair.generate.bind(Keypair);
    const spy = vi.spyOn(Keypair, "generate").mockImplementation(() => {
      const k = real();
      generated.push(k);
      return k;
    });
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), launch.id);
    spy.mockRestore();
    const l = await prisma.launch.findUniqueOrThrow({ where: { id: launch.id }, include: { coin: true } });
    expect(l.step).toBe("indexed");
    expect(l.bundleId).toBe("bundle-1");
    expect(l.coin?.status).toBe("live");
    expect(l.coin?.metadataUri).toBe(`https://media.test/meta/${coin.id}.json`);
    expect(rpcSends).toBe(0);
    expect(bundles).toHaveLength(1);
    const tx = VersionedTransaction.deserialize(Buffer.from(bundles[0]![0]!, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(tipAccount.toBase58());
    expect(keys).toContain(l.mintPubkey);
    // Signed by the launcher and the mint; the mint secret was never stored.
    expect(tx.signatures.filter((s) => s.some((b) => b !== 0))).toHaveLength(2);
    // The mint's secret key appears nowhere in the database.
    const mintKp = generated.find((k) => k.publicKey.toBase58() === l.mintPubkey)!;
    expect(mintKp).toBeTruthy();
    const dump = JSON.stringify(
      await Promise.all([prisma.launch.findMany(), prisma.coin.findMany(), prisma.signedTx.findMany()]),
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    expect(dump).not.toContain(bs58.encode(mintKp.secretKey));
    expect(dump).not.toContain(Buffer.from(mintKp.secretKey).toString("base64"));
    expect(dump).not.toContain(JSON.stringify(Array.from(mintKp.secretKey)));
    expect(await prisma.signedTx.findMany({ select: { purpose: true, signer: true, bundleId: true } })).toEqual([{ purpose: "launch.create", signer: "launcher", bundleId: "bundle-1" }]);
  });

  it("mainnet gate: with DIVVY_MAINNET_ENABLED off nothing is signed and the identity is released", async () => {
    const { launch } = await pendingLaunch("GATE");
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: false }), launch.id);
    const l = await prisma.launch.findUniqueOrThrow({ where: { id: launch.id }, include: { coin: true } });
    expect(l.step).toBe("failed");
    expect(l.error).toMatchObject({ code: "LAUNCHES_PAUSED" });
    expect(l.coin?.status).toBe("failed");
    expect(bundles).toHaveLength(0);
    expect(await prisma.signedTx.count()).toBe(0);
    // The ticker, picture and X account can be used again.
    await expect(pendingLaunch("GATE")).resolves.toBeTruthy();
  });

  it("failLaunch frees the unique identity but keeps the record", async () => {
    const { coin, launch } = await pendingLaunch("FREE");
    await failLaunch(deps({}), launch.id, "LAUNCH_FAILED", "nope");
    const c = await prisma.coin.findUniqueOrThrow({ where: { id: coin.id } });
    expect(c).toMatchObject({ status: "failed", ticker: "FREE", creatorXUserId: null, mint: null });
    expect(c.tickerNorm).not.toBe(foldTicker("FREE"));
  });

  it("indexer: a create event lands the coin; trades are stored once with candles", async () => {
    const { coin, launch } = await pendingLaunch("IDX");
    const pool = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    await prisma.coin.update({ where: { id: coin.id }, data: { poolState: pool.toBase58(), mint: mint.toBase58() } });
    await prisma.launch.update({ where: { id: launch.id }, data: { step: "bundling" } });

    const trader = Keypair.generate().publicKey;
    const body = Buffer.alloc(139);
    pool.toBuffer().copy(body, 0);
    [793_100_000_000_000n, 1_073_025_605_596_382n, 30_000_852_951n, 0n, 0n, 35_000_000_000_000n, 990_000_000n, 1_000_000_000n, 35_000_000_000_000n, 2_500_000n, 6_000_000n, 1_500_000n, 0n].forEach((v, i) =>
      body.writeBigUInt64LE(v, 32 + i * 8),
    );
    body[138] = 1;
    const createBody = Buffer.concat([pool.toBuffer(), trader.toBuffer(), Buffer.alloc(64)]);
    const buyDisc = Buffer.from([250, 234, 13, 123, 213, 156, 19, 236]);
    const message = new MessageV0({
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: [trader, P.launchLab, pool],
      recentBlockhash: bs58.encode(Buffer.alloc(32, 1)),
      compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0, 2], data: Buffer.concat([buyDisc, Buffer.alloc(24)]) }],
      addressTableLookups: [],
    });
    const ev = (disc: Buffer, b: Buffer) => ({ programIdIndex: 1, accounts: [1], data: bs58.encode(Buffer.concat([EVENT_IX_TAG_LE, disc, b])) });
    const tx = {
      slot: 42,
      blockTime: Math.floor(Date.parse("2026-10-26T10:07:31Z") / 1000),
      transaction: { message, signatures: ["sig1"] },
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [], loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [{ index: 0, instructions: [ev(POOL_CREATE_EVENT_DISC, createBody), ev(TRADE_EVENT_DISC, body)] }] },
    } as unknown as VersionedTransactionResponse;

    const indexer = new Indexer(deps({}));
    const touched = new Set<string>();
    await indexer.onPlatformTx("sig1", tx, touched);
    await indexer.onPlatformTx("sig1", tx, touched); // replay: no duplicates

    expect((await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } })).step).toBe("indexed");
    expect((await prisma.coin.findUniqueOrThrow({ where: { id: coin.id } })).status).toBe("live");
    const trades = await prisma.trade.findMany();
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ side: "buy", solAmount: 1_000_000_000n, platformFee: 6_000_000n, wallet: trader.toBase58(), slot: 42n });
    const candles = await prisma.candle.findMany({ orderBy: { tf: "asc" } });
    expect(candles.map((c) => [c.tf, c.ts.toISOString(), c.volSol])).toEqual([
      ["m1", "2026-10-26T10:07:00.000Z", 1_000_000_000n],
      ["m5", "2026-10-26T10:05:00.000Z", 1_000_000_000n],
      ["h1", "2026-10-26T10:00:00.000Z", 1_000_000_000n],
      ["d1", "2026-10-26T00:00:00.000Z", 1_000_000_000n],
    ]);
    expect(touched.has(coin.id)).toBe(true);
  });
});
