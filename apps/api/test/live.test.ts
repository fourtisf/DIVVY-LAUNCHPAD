/**
 * Live-mode integration tests: real Postgres (a separate "<db>_test" database) and Redis, a stub Solana connection,
 * local storage in a temp dir. Skipped when DATABASE_URL / REDIS_URL aren't set.
 */
import { execSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bs58 from "bs58";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { Redis } from "ioredis";
import { PrismaClient } from "@divvy/db";
import { ApiErrorSchema, CheckResponseSchema, CoinDetailSchema, CoinListSchema, ConfigSchema, LaunchStatusSchema, MeSchema, StatsSchema, UploadResponseSchema } from "@divvy/shared";
import { foldName, foldTicker } from "@divvy/shared";
import type { Env } from "../src/env";
import { feePaymentProblem } from "../src/live/launchfee";
import { mergeCandles } from "../src/live/routes/public";
import { expectShape } from "./util";

const BASE_DB = process.env.DATABASE_URL;
const REDIS = process.env.REDIS_URL;
const run = !!(BASE_DB && REDIS);
// A separate database: pg_trgm lives in the public schema, so a test schema would not see it.
const DB = BASE_DB ? BASE_DB.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2") : "";

const admin = keypair();
const user = keypair();
const platform = Keypair.generate().publicKey.toBase58();

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { address: bs58.encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32)), privateKey };
}

/** Age of the test wallets' first transaction, in days (the free-launch guard reads it). */
let walletAgeDays = 30;

const fakeConn = {
  rpcEndpoint: "https://rpc.invalid",
  getBalance: async () => 2_000_000_000,
  getSignaturesForAddress: async () => (walletAgeDays > 0 ? [{ signature: "s", slot: 1, err: null, blockTime: Math.floor(Date.now() / 1000) - walletAgeDays * 86_400 }] : []),
  getLatestBlockhash: async () => ({ blockhash: bs58.encode(Buffer.alloc(32, 3)), lastValidBlockHeight: 100 }),
  getAccountInfo: async () => null,
  getMultipleAccountsInfo: async () => [null, null],
  getTokenAccountBalance: async () => {
    throw new Error("no account");
  },
} as unknown as Connection;

/** A confirmed SOL transfer the way getTransaction returns it, for the launch-fee checks. */
function transferTx(from: string, to: string, lamports: number, o: { err?: unknown; ageSec?: number } = {}): VersionedTransactionResponse {
  const message = new TransactionMessage({
    payerKey: new PublicKey(from),
    recentBlockhash: bs58.encode(Buffer.alloc(32, 3)),
    instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports })],
  }).compileToV0Message();
  return {
    slot: 1,
    version: 0,
    blockTime: Math.floor(Date.now() / 1000) - (o.ageSec ?? 5),
    transaction: { message, signatures: [] },
    meta: { err: o.err ?? null, fee: 5000, preBalances: [1e9, 0, 1], postBalances: [1e9 - lamports - 5000, lamports, 1], innerInstructions: [], loadedAddresses: { writable: [], readonly: [] }, logMessages: [] },
  } as unknown as VersionedTransactionResponse;
}

describe("launch fee payment check", () => {
  const payer = Keypair.generate().publicKey.toBase58();
  const wallet = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const now = Math.floor(Date.now() / 1000);
  const check = (tx: VersionedTransactionResponse) => feePaymentProblem(tx, payer, wallet, 20_000_000n, now);

  it("accepts the fee or more, sent from the signed-in wallet to the launch wallet", () => {
    expect(check(transferTx(payer, wallet, 20_000_000))).toBeNull();
    expect(check(transferTx(payer, wallet, 25_000_000))).toBeNull();
  });

  it("refuses a short, failed, stale, foreign or misdirected payment", () => {
    expect(check(transferTx(payer, wallet, 10_000_000))).toMatch(/0\.01 SOL; launching costs 0\.02 SOL/);
    expect(check(transferTx(payer, wallet, 20_000_000, { err: { InstructionError: [0, "Custom"] } }))).toMatch(/failed/);
    expect(check(transferTx(payer, wallet, 20_000_000, { ageSec: 7200 }))).toMatch(/more than an hour old/);
    expect(check(transferTx(other, wallet, 20_000_000))).toMatch(/signed in with/);
    expect(check(transferTx(payer, other, 20_000_000))).toMatch(/launch wallet/);
  });
});

let app: FastifyInstance;
let prisma: PrismaClient;
let env: Env;

describe.skipIf(!run)("live mode", () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      API_MODE: "live",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: DB,
      SOLANA_CLUSTER: "devnet",
      SOLANA_RPC_URL: "https://rpc.invalid",
      DIVVY_PLATFORM_CONFIG: platform,
      STORAGE_DRIVER: "local",
      STORAGE_DIR: mkdtempSync(join(tmpdir(), "divvy-live-media-")),
      PUBLIC_MEDIA_BASE: "http://localhost:3000/api/media/files",
      ADMIN_WALLETS: admin.address,
      BLOCKED_COUNTRIES: "US",
      WEB_ORIGIN: "http://localhost:3000",
    });
    execSync("./node_modules/.bin/prisma migrate deploy", { cwd: join(__dirname, "../../../packages/db"), env: { ...process.env, DATABASE_URL: DB }, stdio: "ignore" });
    prisma = new PrismaClient({ datasources: { db: { url: DB } } });
    // Clean slate for every run, rate-limit counters and launch cooldowns included.
    const r = new Redis(REDIS!);
    const stale = [...(await r.keys("divvy-rl:*")), ...(await r.keys("divvy:launch-cooldown:*"))];
    if (stale.length) await r.del(...stale);
    await r.quit();
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);

    const nvda = await prisma.dividendAsset.create({
      data: { symbol: "NVDAx", name: "Nvidia", kind: "stock", mint: Keypair.generate().publicKey.toBase58(), decimals: 8, tokenProgram: "token_2022", mono: "NV", chipBg: "#76B900", chipFg: "#0D2200", featured: true, source: "test", fetchedAt: new Date() },
    });
    const creator = await prisma.user.create({ data: { wallet: Keypair.generate().publicKey.toBase58(), xHandle: "degenkara", xUserId: "42" } });
    const coin = await prisma.coin.create({
      data: {
        mint: Keypair.generate().publicKey.toBase58(), ticker: "CHIPDOG", tickerNorm: foldTicker("CHIPDOG"), name: "Chip Dog", nameNorm: foldName("Chip Dog"),
        imageUrl: "http://localhost/x.webp", imageSha256: "a".repeat(64), imagePhash: "0123456789abcdef", dividendAssetId: nvda.id, creatorUserId: creator.id,
        creatorWallet: creator.wallet, creatorXUserId: "42", poolState: Keypair.generate().publicKey.toBase58(), status: "live", launchedAt: new Date(Date.now() - 2 * 3600_000),
      },
    });
    await prisma.coinStats.create({ data: { coinId: coin.id, priceSol: "0.00000003", holders: 12, volume24hUsd: 5000, progressBps: 2500, spark: [1, 2, 3] } });
    await prisma.reservedTicker.create({ data: { tickerNorm: "PEPE", source: "test", refreshedAt: new Date() } });

    const { buildApp } = await import("../src/app");
    const { loadEnv } = await import("../src/env");
    const { createLiveDeps } = await import("../src/live/deps");
    env = loadEnv();
    app = await buildApp({ env, live: createLiveDeps(env, { prisma, conn: fakeConn }) });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url, payload: payload as object, headers });

  async function login(k: ReturnType<typeof keypair>) {
    const n = (await get(`/api/auth/nonce?address=${k.address}`)).json() as { nonce: string; message: string };
    const signature = bs58.encode(sign(null, Buffer.from(n.message), k.privateKey));
    const r = await post("/api/auth/verify", { address: k.address, signature, nonce: n.nonce });
    expect(r.statusCode).toBe(200);
    return { cookie: String(r.headers["set-cookie"]).split(";")[0]! };
  }

  const picture = () =>
    sharp({ create: { width: 200, height: 200, channels: 3, background: "#203040" } })
      .composite([{ input: Buffer.from('<svg width="200" height="200"><circle cx="70" cy="90" r="50" fill="#fc0"/><rect x="120" y="20" width="50" height="160" fill="#0cf"/></svg>') }])
      .png()
      .toBuffer();
  const upload = (img: Buffer, headers: Record<string, string> = {}) => {
    const boundary = "----divvylive";
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), img, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return app.inject({ method: "POST", url: "/api/upload", payload, headers: { ...headers, "content-type": `multipart/form-data; boundary=${boundary}` } });
  };

  it("serves config, stats and the board from Postgres in the contract shapes", async () => {
    const c = expectShape(ConfigSchema, (await get("/api/config")).json()) as { demo: boolean; network: string };
    expect(c.demo).toBe(false);
    expect(c.network).toBe("devnet");
    expectShape(StatsSchema, (await get("/api/stats")).json());
    const list = expectShape(CoinListSchema, (await get("/api/coins")).json()) as { items: { ticker: string }[] };
    expect(list.items.map((i) => i.ticker)).toEqual(["CHIPDOG"]);
    const d = expectShape(CoinDetailSchema, (await get("/api/coins/ch1pd0g")).json()) as { creator: { label: string }; progress: number };
    expect(d.creator.label).toBe("degenkara");
    expect(d.progress).toBe(0.25);
  });

  it("checks the format and reserved tickers only: tickers, names and X accounts can repeat (owner decision 2026-10-27)", async () => {
    const r = expectShape(CheckResponseSchema, (await get(`/api/check?ticker=CH1PD0G&name=${encodeURIComponent("The Real Chip Dog")}&x=degenkara`)).json()) as Record<string, { code: string }>;
    expect(r.ticker!.code).toBe("TICKER_OK");
    expect(r.name!.code).toBe("NAME_OK");
    expect(r.x!.code).toBe("X_OK");
    expect(((await get("/api/check?ticker=P3P3")).json() as Record<string, { code: string }>).ticker!.code).toBe("TICKER_RESERVED");
    expect(((await get("/api/check?ticker=CHIP!")).json() as Record<string, { code: string }>).ticker!.code).toBe("TICKER_CHARS");
    // Coin pages open by mint (links) or by ticker (the first coin launched with it).
    const chip = await prisma.coin.findFirstOrThrow({ where: { tickerNorm: "CHIPDOG" } });
    expect(((await get(`/api/coins/${chip.mint}`)).json() as { ticker: string }).ticker).toBe("CHIPDOG");
  });

  it("signs in with a DB-backed session and flags admins", async () => {
    const a = await login(admin);
    const me = expectShape(MeSchema, (await get("/api/me", a)).json()) as { wallet: string; isAdmin: boolean };
    expect(me).toMatchObject({ wallet: admin.address, isAdmin: true });
    expect(await prisma.session.count()).toBeGreaterThan(0);
    const u = await login(user);
    expect(((await get("/api/me", u)).json() as { isAdmin: boolean }).isAdmin).toBe(false);
    expect((await get("/api/admin/overview", u)).statusCode).toBe(403);
    expect((await get("/api/admin/overview", a)).statusCode).toBe(200);
    // Admin powers end 12 hours after sign-in, even though the session itself lasts a week (audit).
    await prisma.session.updateMany({ where: { user: { wallet: admin.address } }, data: { createdAt: new Date(Date.now() - 13 * 3_600_000) } });
    expect((await get("/api/admin/overview", a)).statusCode).toBe(403);
    expect(((await get("/api/me", a)).json() as { wallet: string; isAdmin: boolean })).toMatchObject({ wallet: admin.address, isAdmin: false });
  });

  it("uploads, launches through the queue, and hides the mint until it lands", async () => {
    const u = await login(user);
    const img = await picture();
    expect((await upload(img)).statusCode).toBe(401);
    const up = expectShape(UploadResponseSchema, (await upload(img, u)).json()) as { imageId: string; check: { status: string } };
    expect(up.check.status).toBe("ok");

    const body = { name: "Moon Pig", ticker: "moonpig", description: "Oink", imageId: up.imageId, dividendAsset: "NVDAx", website: "https://moon.pig", telegram: "@moonpigchat", x: "https://x.com/MoonPigFun?s=11" };
    expect((await post("/api/launch", body, { ...u, "x-geo-country": "US" })).statusCode).toBe(451);
    expect((await post("/api/launch", body, { ...u, origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await post("/api/launch", { ...body, website: "javascript:alert(1)" }, u)).statusCode).toBe(422);
    // Without X, a brand-new wallet can't launch for free, however much SOL it holds.
    walletAgeDays = 0;
    expect(((await post("/api/launch", body, u)).json() as { code: string }).code).toBe("NEEDS_X_OR_SOL");
    walletAgeDays = 30;
    // Symbols are refused instead of being dropped from the minted ticker.
    expect(((await post("/api/launch", { ...body, ticker: "MOONPIG!" }, u)).json() as { code: string }).code).toBe("TICKER_CHARS");
    // The X link is the project's account; a post's link isn't one.
    expect(((await post("/api/launch", { ...body, x: "https://x.com/moonpigfun/status/1" }, u)).json() as { code: string }).code).toBe("X_INVALID");

    const res = await post("/api/launch", body, u);
    expect(res.statusCode).toBe(201);
    const { launchId } = res.json() as { launchId: string };
    const launch = await prisma.launch.findUniqueOrThrow({ where: { id: launchId }, include: { coin: true } });
    expect(launch.coin!.status).toBe("pending");
    expect(launch.coin!.links).toMatchObject({ website: "https://moon.pig", telegram: "https://t.me/moonpigchat", x: "https://x.com/moonpigfun" });

    // A second launch from the same wallet hits the cooldown (free launches).
    expect((await post("/api/launch", { ...body, ticker: "OTHER", name: "Other Pig" }, u)).statusCode).toBe(429);

    const s1 = expectShape(LaunchStatusSchema, (await get(`/api/launch/${launchId}`)).json()) as { step: string; mint?: string };
    expect(s1.step).toBe("checking");
    expect(s1.mint).toBeUndefined();
    const mint = Keypair.generate().publicKey.toBase58();
    await prisma.coin.update({ where: { id: launch.coinId! }, data: { mint } });
    await prisma.launch.update({ where: { id: launchId }, data: { step: "bundling", mintPubkey: mint } });
    expect(((await get(`/api/launch/${launchId}`)).json() as { mint?: string }).mint).toBeUndefined();
    await prisma.launch.update({ where: { id: launchId }, data: { step: "landed", signature: "sig" } });
    expect(((await get(`/api/launch/${launchId}`)).json() as { mint?: string }).mint).toBe(mint);

    // Another wallet can launch a coin with the same ticker, name and X account.
    const other = await login(keypair());
    const theirs = (await upload(img, other)).json() as { imageId: string };
    expect((await post("/api/launch", { ...body, imageId: theirs.imageId }, other)).statusCode).toBe(201);
    expect(await prisma.coin.count({ where: { tickerNorm: "MOONPIG" } })).toBe(2);
  });

  it("takes any picture, even one another coin already uses (owner decision 2026-10-27)", async () => {
    const img = await picture();
    expect(((await upload(img, await login(user))).json() as { check: { status: string } }).check.status).toBe("ok");
    expect(((await upload(img, await login(keypair()))).json() as { check: { status: string } }).check.status).toBe("ok");
  });

  it("charges the launch fee when one is set: one launch per payment, no cooldown or daily cap, credit after a failure", async () => {
    const { buildApp } = await import("../src/app");
    const { createLiveDeps } = await import("../src/live/deps");
    const feeWallet = Keypair.generate().publicKey.toBase58();
    const txs = new Map<string, VersionedTransactionResponse>();
    const conn = { ...fakeConn, getTransaction: async (sig: string) => txs.get(sig) ?? null } as unknown as Connection;
    const paidEnv = { ...env, LAUNCH_FEE_LAMPORTS: 20_000_000n, LAUNCH_FEE_WALLET: feeWallet };
    const paid = await buildApp({ env: paidEnv, live: createLiveDeps(paidEnv, { prisma, conn }) });
    // The fee stands in for the free-launch guard: this wallet has no X and no history.
    walletAgeDays = 0;
    try {
      const cfg = expectShape(ConfigSchema, (await paid.inject({ method: "GET", url: "/api/config" })).json()) as { launchFee: { amount: { ui: number }; to: string | null } };
      expect(cfg.launchFee).toMatchObject({ amount: { ui: 0.02 }, to: feeWallet });

      // `user` launched Moon Pig above, so the free launch's cooldown is still running.
      const u = await login(user);
      const img = await picture();
      const coin = async (name: string, ticker: string) => ({ name, ticker, dividendAsset: "NVDAx", imageId: ((await upload(img, u)).json() as { imageId: string }).imageId });
      const launch = (body: object) => paid.inject({ method: "POST", url: "/api/launch", payload: body, headers: u });
      const code = (r: { json: () => unknown }) => (r.json() as { code: string }).code;
      const sig = (n: number) => bs58.encode(Buffer.alloc(64, n));

      const fish = await coin("Gold Fish", "GFISH");
      const ask = await launch(fish);
      expect(ask.statusCode).toBe(402);
      expect(code(ask)).toBe("FEE_REQUIRED");
      expect(code(await launch({ ...fish, feeSig: sig(1) }))).toBe("FEE_NOT_FOUND");
      txs.set(sig(2), transferTx(user.address, feeWallet, 10_000_000));
      expect(code(await launch({ ...fish, feeSig: sig(2) }))).toBe("BAD_FEE");
      txs.set(sig(3), transferTx(admin.address, feeWallet, 20_000_000));
      expect(code(await launch({ ...fish, feeSig: sig(3) }))).toBe("BAD_FEE");

      txs.set(sig(4), transferTx(user.address, feeWallet, 20_000_000));
      const first = await launch({ ...fish, feeSig: sig(4) });
      expect(first.statusCode).toBe(201);
      const fee = await prisma.launchFee.findUniqueOrThrow({ where: { sig: sig(4) } });
      expect(fee).toMatchObject({ lamports: 20_000_000n, launchId: (first.json() as { launchId: string }).launchId });

      // One payment, one launch; the next payment launches again straight away, past the daily cap.
      const cat = await coin("Rocket Cat", "RCAT");
      expect(code(await launch({ ...cat, feeSig: sig(4) }))).toBe("FEE_USED");
      txs.set(sig(5), transferTx(user.address, feeWallet, 20_000_000));
      const second = await launch({ ...cat, feeSig: sig(5) });
      expect(second.statusCode).toBe(201);

      // A launch that fails gives its fee back (worker failLaunch); the next launch uses it without paying.
      await prisma.launchFee.updateMany({ where: { sig: sig(5) }, data: { launchId: null } });
      const whale = await launch(await coin("Sky Whale", "SWHALE"));
      expect(whale.statusCode).toBe(201);
      expect((await prisma.launchFee.findUniqueOrThrow({ where: { sig: sig(5) } })).launchId).toBe((whale.json() as { launchId: string }).launchId);
      expect(await prisma.launch.count({ where: { userId: fee.userId } })).toBeGreaterThan(3);
      expect(code(await launch(await coin("Deep Crab", "DCRAB")))).toBe("FEE_REQUIRED");
    } finally {
      walletAgeDays = 30;
      await paid.close();
    }
  });

  it("serves 15m and 4h candles merged from the stored 5m and 1h ones", async () => {
    const coin = await prisma.coin.findFirstOrThrow({ where: { tickerNorm: "CHIPDOG" } });
    const at = (min: number) => new Date(Date.UTC(2026, 9, 27, 9, min));
    const rows: [number, number, number, number, number, bigint][] = [
      [0, 1, 3, 1, 2, 10n],
      [5, 2, 4, 2, 3, 20n],
      [10, 3, 3, 0.5, 1, 30n],
      [15, 1, 2, 1, 2, 40n],
    ];
    await prisma.candle.createMany({ data: rows.map(([m, o, h, l, c, v]) => ({ coinId: coin.id, tf: "m5", ts: at(m), o, h, l, c, volSol: v })) });
    const r = (await get(`/api/coins/${coin.mint}/candles?tf=15m&unit=price`)).json() as { tf: string; items: { t: number; vol: { raw: string } }[] };
    expect(r.tf).toBe("15m");
    expect(r.items.map((i) => ({ t: i.t, vol: i.vol.raw }))).toEqual([
      { t: at(0).getTime() / 1000, vol: "60" },
      { t: at(15).getTime() / 1000, vol: "40" },
    ]);
    // The prices themselves (the test has no SOL price, so they read 0 above):
    const merged = mergeCandles(
      rows.map(([m, o, h, l, c, v]) => ({ ts: at(m), o, h, l, c, volSol: v })),
      900,
    );
    expect(merged.map(({ o, h, l, c }) => ({ o, h, l, c }))).toEqual([
      { o: 1, h: 4, l: 0.5, c: 1 },
      { o: 1, h: 2, l: 1, c: 2 },
    ]);
    await prisma.candle.deleteMany({ where: { coinId: coin.id } });
  });

  it("relays the browser's RPC calls to the server's RPC, and only the methods the site uses", async () => {
    const call = (method: string, params: unknown[] = []) => post("/api/rpc", { jsonrpc: "2.0", id: 1, method, params });
    expect((await call("getProgramAccounts")).statusCode).toBe(403);
    expect((await post("/api/rpc", [{ jsonrpc: "2.0", id: 1, method: "getBalance" }])).statusCode).toBe(400);
    const seen: { url: string; body: { method: string } }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      seen.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: 5 } }));
    });
    try {
      const r = await call("getBalance", [admin.address]);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ result: { value: 5 } });
      expect(seen).toEqual([{ url: "https://rpc.invalid", body: { jsonrpc: "2.0", id: 1, method: "getBalance", params: [admin.address] } }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets admins pause launches and hide coins, with an audit trail", async () => {
    const a = await login(admin);
    expect((await post("/api/admin/settings", { launchesOpen: false, reason: "Maintenance" }, a)).statusCode).toBe(200);
    expect(((await get("/api/config")).json() as { launchesOpen: boolean }).launchesOpen).toBe(false);
    const other = await login(keypair());
    const r = await post("/api/launch", { name: "X", ticker: "XX", imageId: "nope", dividendAsset: "NVDAx" }, other);
    expect(r.statusCode).toBe(503);
    expectShape(ApiErrorSchema, r.json());
    // An admin still gets past the pause (the owner's test launch); here the next check refuses the upload.
    const mine = await post("/api/launch", { name: "X", ticker: "XX", imageId: "nope", dividendAsset: "NVDAx" }, a);
    expect(mine.statusCode).not.toBe(503);
    await post("/api/admin/settings", { launchesOpen: true, reason: null }, a);

    const coin = await prisma.coin.findFirstOrThrow({ where: { tickerNorm: "CHIPDOG" } });
    expect((await post(`/api/coins/${coin.mint}/report`, { reason: "copy", details: "dup" })).statusCode).toBe(201);
    expect((await post(`/api/admin/coins/${coin.mint}/hide`, { hidden: true, reason: "test" }, a)).statusCode).toBe(200);
    expect((await get("/api/coins/CHIPDOG")).statusCode).toBe(404);
    expect(await prisma.adminAction.count()).toBeGreaterThanOrEqual(3);
  });
});
