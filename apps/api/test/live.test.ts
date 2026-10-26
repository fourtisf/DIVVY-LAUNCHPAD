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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Keypair, type Connection } from "@solana/web3.js";
import { Redis } from "ioredis";
import { PrismaClient } from "@divvy/db";
import { ApiErrorSchema, CheckResponseSchema, CoinDetailSchema, CoinListSchema, ConfigSchema, LaunchStatusSchema, MeSchema, StatsSchema, UploadResponseSchema } from "@divvy/shared";
import { foldName, foldTicker } from "@divvy/shared";
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

let app: FastifyInstance;
let prisma: PrismaClient;

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
    const env = loadEnv();
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

  it("runs the anti-vamp checks against the database", async () => {
    const r = expectShape(CheckResponseSchema, (await get(`/api/check?ticker=CH1PD0G&name=${encodeURIComponent("The Real Chip Dog")}&x=degenkara`)).json()) as Record<string, { code: string }>;
    expect(r.ticker!.code).toBe("TICKER_TAKEN");
    expect(r.name!.code).toBe("NAME_SIMILAR");
    expect(r.x!.code).toBe("X_TAKEN");
    expect(((await get("/api/check?ticker=P3P3")).json() as Record<string, { code: string }>).ticker!.code).toBe("TICKER_RESERVED");
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
  });

  it("uploads, launches through the queue, and hides the mint until it lands", async () => {
    const u = await login(user);
    const img = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#203040" } })
      .composite([{ input: Buffer.from('<svg width="200" height="200"><circle cx="70" cy="90" r="50" fill="#fc0"/><rect x="120" y="20" width="50" height="160" fill="#0cf"/></svg>') }])
      .png()
      .toBuffer();
    const boundary = "----divvylive";
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), img, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    expect((await app.inject({ method: "POST", url: "/api/upload", payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } })).statusCode).toBe(401);
    const up = await app.inject({ method: "POST", url: "/api/upload", payload, headers: { ...u, "content-type": `multipart/form-data; boundary=${boundary}` } });
    const upload = expectShape(UploadResponseSchema, up.json()) as { imageId: string; check: { status: string } };
    expect(upload.check.status).toBe("ok");

    const body = { name: "Moon Pig", ticker: "moonpig", description: "Oink", imageId: upload.imageId, dividendAsset: "NVDAx", website: "https://moon.pig", telegram: "@moonpigchat" };
    expect((await post("/api/launch", body, { ...u, "x-geo-country": "US" })).statusCode).toBe(451);
    expect((await post("/api/launch", body, { ...u, origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await post("/api/launch", { ...body, website: "javascript:alert(1)" }, u)).statusCode).toBe(422);
    // Without X, a brand-new wallet can't launch for free, however much SOL it holds.
    walletAgeDays = 0;
    expect(((await post("/api/launch", body, u)).json() as { code: string }).code).toBe("NEEDS_X_OR_SOL");
    walletAgeDays = 30;
    // Symbols are refused instead of being dropped from the minted ticker.
    expect(((await post("/api/launch", { ...body, ticker: "MOONPIG!" }, u)).json() as { code: string }).code).toBe("TICKER_CHARS");

    const res = await post("/api/launch", body, u);
    expect(res.statusCode).toBe(201);
    const { launchId } = res.json() as { launchId: string };
    const launch = await prisma.launch.findUniqueOrThrow({ where: { id: launchId }, include: { coin: true } });
    expect(launch.coin!.status).toBe("pending");
    expect(launch.coin!.links).toMatchObject({ website: "https://moon.pig", telegram: "https://t.me/moonpigchat" });

    // A second launch from the same wallet hits the cooldown; another wallet can't reuse the identity.
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

    // The pending coin already holds its identity.
    const chk = (await get("/api/check?ticker=M00NP1G")).json() as { ticker: { code: string; collidesWith: { mint: string | null } } };
    expect(chk.ticker.code).toBe("TICKER_TAKEN");
  });

  it("lets admins pause launches and hide coins, with an audit trail", async () => {
    const a = await login(admin);
    expect((await post("/api/admin/settings", { launchesOpen: false, reason: "Maintenance" }, a)).statusCode).toBe(200);
    expect(((await get("/api/config")).json() as { launchesOpen: boolean }).launchesOpen).toBe(false);
    const other = await login(keypair());
    const r = await post("/api/launch", { name: "X", ticker: "XX", imageId: "nope", dividendAsset: "NVDAx" }, other);
    expect(r.statusCode).toBe(503);
    expectShape(ApiErrorSchema, r.json());
    await post("/api/admin/settings", { launchesOpen: true, reason: null }, a);

    const coin = await prisma.coin.findUniqueOrThrow({ where: { tickerNorm: "CHIPDOG" } });
    expect((await post(`/api/coins/${coin.mint}/report`, { reason: "copy", details: "dup" })).statusCode).toBe(201);
    expect((await post(`/api/admin/coins/${coin.mint}/hide`, { hidden: true, reason: "test" }, a)).statusCode).toBe(200);
    expect((await get("/api/coins/CHIPDOG")).statusCode).toBe(404);
    expect(await prisma.adminAction.count()).toBeGreaterThanOrEqual(3);
  });
});
