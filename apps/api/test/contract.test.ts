/**
 * Contract tests: every HANDOFF §6 route answers with exactly the shared zod shape.
 * `.strict()` is applied recursively so an extra field fails the test as well as a missing one.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ApiErrorSchema,
  CandleListSchema,
  CheckResponseSchema,
  ClaimsSchema,
  CoinDetailSchema,
  CoinListSchema,
  CoinPayoutListSchema,
  ConfigSchema,
  HolderListSchema,
  LaunchStatusSchema,
  MeSchema,
  MeterSchema,
  NonceResponseSchema,
  PayoutListSchema,
  StatsSchema,
  TradeBuildResponseSchema,
  TradeListSchema,
  UploadResponseSchema,
} from "@divvy/shared";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";
import { memoryKv } from "../src/kv";
import { MockStore } from "../src/mock/store";
import { expectShape } from "./util";

let app: FastifyInstance;
let store: MockStore;
const env = loadEnv({ API_MODE: "mock", NODE_ENV: "test", LOG_LEVEL: "silent", WEB_ORIGIN: "http://localhost:3000" });

beforeAll(async () => {
  store = new MockStore();
  app = await buildApp({ env, store, kv: memoryKv() });
});
afterAll(async () => app.close());

const get = async (url: string, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method: "GET", url, headers });
  return { status: r.statusCode, body: r.json() as unknown, headers: r.headers };
};

describe("read endpoints", () => {
  it("GET /api/config", async () => {
    const r = await get("/api/config");
    expect(r.status).toBe(200);
    const c = expectShape(ConfigSchema, r.body) as z.infer<typeof ConfigSchema>;
    const f = c.fees;
    expect(f.protocolBps + f.holdersBps + f.creatorBps + f.divvyBps).toBe(f.tradeFeeBps);
    expect(c.dividendAssets.filter((a) => a.kind === "stock")).toHaveLength(11);
    expect(c.dividendAssets.filter((a) => a.mint !== null).map((a) => a.symbol)).toEqual(["SOL"]);
  });

  it("GET /api/stats", async () => {
    const r = await get("/api/stats");
    const s = expectShape(StatsSchema, r.body) as z.infer<typeof StatsSchema>;
    expect(s.coinsLive).toBe(30);
    expect(s.activity.length).toBeGreaterThan(10);
  });

  it("GET /api/coins with sort, filter, search and paging", async () => {
    for (const sort of ["trending", "new", "payers", "graduate"]) {
      const r = await get(`/api/coins?sort=${sort}`);
      expect((expectShape(CoinListSchema, r.body) as { items: unknown[] }).items).toHaveLength(30);
    }
    const nv = expectShape(CoinListSchema, (await get("/api/coins?pays=NVDAx")).body) as z.infer<typeof CoinListSchema>;
    expect(nv.items.every((c) => c.dividendAsset === "NVDAx")).toBe(true);
    const q = expectShape(CoinListSchema, (await get("/api/coins?q=tesla")).body) as z.infer<typeof CoinListSchema>;
    expect(q.items.every((c) => c.dividendAsset === "TSLAx")).toBe(true);
    const p1 = expectShape(CoinListSchema, (await get("/api/coins?limit=10")).body) as z.infer<typeof CoinListSchema>;
    expect(p1.nextCursor).toBe("10");
    expect((await get("/api/coins?sort=nope")).status).toBe(400);
  });

  it("GET /api/coins/:ticker and every per-mint resource", async () => {
    const d = expectShape(CoinDetailSchema, (await get("/api/coins/chipdog")).body) as z.infer<typeof CoinDetailSchema>;
    expect(d.ticker).toBe("CHIPDOG");
    const m = d.mint;
    expectShape(TradeListSchema, (await get(`/api/coins/${m}/trades`)).body);
    for (const tf of ["1m", "5m", "1h", "1d"]) {
      const c = expectShape(CandleListSchema, (await get(`/api/coins/${m}/candles?tf=${tf}&unit=mcap`)).body) as z.infer<typeof CandleListSchema>;
      expect(c.items.length).toBeGreaterThanOrEqual(2);
    }
    const h = expectShape(HolderListSchema, (await get(`/api/coins/${m}/holders`)).body) as z.infer<typeof HolderListSchema>;
    expect(h.items[0]!.excluded).toBe(true);
    expectShape(CoinPayoutListSchema, (await get(`/api/coins/${m}/payouts`)).body);
    expectShape(MeterSchema, (await get(`/api/coins/${m}/meter`)).body);
  });

  it("404s use the error contract", async () => {
    const r = await get("/api/coins/NOPE");
    expect(r.status).toBe(404);
    expectShape(ApiErrorSchema, r.body);
  });

  it("GET /api/payouts with an asset filter", async () => {
    const all = expectShape(PayoutListSchema, (await get("/api/payouts")).body) as z.infer<typeof PayoutListSchema>;
    const spy = expectShape(PayoutListSchema, (await get("/api/payouts?asset=SPYx")).body) as z.infer<typeof PayoutListSchema>;
    expect(spy.items.every((i) => i.assetSymbol === "SPYx")).toBe(true);
    // Filters apply to the receipts, not the totals (pendingUsd grows with the clock, so compare the rest).
    expect({ ...spy.summary, pendingUsd: 0 }).toEqual({ ...all.summary, pendingUsd: 0 });
  });

  it("serves the demo coin pictures", async () => {
    const r = await app.inject({ method: "GET", url: "/api/media/coin/CHIPDOG.svg" });
    expect(r.headers["content-type"]).toContain("image/svg+xml");
  });
});

describe("anti-vamp, upload and launch", () => {
  it("GET /api/check runs the shared checks", async () => {
    const r = expectShape(CheckResponseSchema, (await get(`/api/check?ticker=CH1PD0G&name=${encodeURIComponent("Chip Dog Official")}&x=@degenkara`)).body) as z.infer<typeof CheckResponseSchema>;
    expect(r.ticker?.code).toBe("TICKER_TAKEN");
    expect(r.name?.code).toBe("NAME_SIMILAR");
    expect(r.x?.code).toBe("X_TAKEN");
  });

  const upload = async (buf: Buffer, type = "image/png") => {
    const boundary = "----divvytest";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: ${type}\r\n\r\n`),
      buf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await app.inject({ method: "POST", url: "/api/upload", payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    return { status: r.statusCode, body: r.json() as unknown };
  };

  it("refuses a resized copy of an existing coin's picture", async () => {
    const svg = (await app.inject({ method: "GET", url: "/api/media/coin/FROG.svg" })).rawPayload;
    const copy = await sharp(svg).resize(300, 300).modulate({ brightness: 1.08 }).png().toBuffer();
    const r = await upload(copy);
    const u = expectShape(UploadResponseSchema, r.body) as z.infer<typeof UploadResponseSchema>;
    expect(u.check.status).toBe("fail");
    expect(u.check.message).toBe("Looks like the picture of $FROG");
  });

  it("refuses files that aren't images", async () => {
    const r = await upload(Buffer.from("not an image"), "text/plain");
    expect(r.status).toBe(422);
    expect(expectShape(ApiErrorSchema, r.body)).toMatchObject({ code: "IMAGE_TYPE" });
  });

  it("launches a coin through checking → bundling → landed → indexed, hiding the mint until it lands", async () => {
    const img = await sharp({ create: { width: 256, height: 256, channels: 3, background: "#123456" } })
      .composite([{ input: Buffer.from('<svg width="256" height="256"><circle cx="90" cy="120" r="60" fill="#ff0"/><rect x="150" y="30" width="80" height="200" fill="#f0f"/></svg>') }])
      .png()
      .toBuffer();
    const u = expectShape(UploadResponseSchema, (await upload(img)).body) as z.infer<typeof UploadResponseSchema>;
    expect(u.check.status).toBe("ok");

    // Server refuses a copycat ticker even if the client skipped the check.
    const bad = await app.inject({ method: "POST", url: "/api/launch", payload: { name: "Totally New", ticker: "ch1pd0g", imageId: u.imageId, dividendAsset: "NVDAx" } });
    expect(bad.statusCode).toBe(422);
    expect(expectShape(ApiErrorSchema, bad.json())).toMatchObject({ code: "TICKER_TAKEN", collidesWith: { ticker: "CHIPDOG" } });

    const res = await app.inject({ method: "POST", url: "/api/launch", payload: { name: "Moon Pig", ticker: "moonpig", description: "Oink", imageId: u.imageId, dividendAsset: "SPYx" } });
    expect(res.statusCode).toBe(201);
    const { launchId } = res.json() as { launchId: string };

    // A second launch of the same ticker while the first is in flight is refused.
    const dup = await app.inject({ method: "POST", url: "/api/launch", payload: { name: "Moon Pig Two", ticker: "M00NPIG", imageId: u.imageId, dividendAsset: "SPYx" } });
    expect(dup.statusCode).toBe(422);

    const first = expectShape(LaunchStatusSchema, (await get(`/api/launch/${launchId}`)).body) as z.infer<typeof LaunchStatusSchema>;
    expect(first.step).toBe("checking");
    expect(first.mint).toBeUndefined();

    const l = store.launches.get(launchId)!;
    l.startedAt -= 2500; // fast-forward into "landed"
    const landed = expectShape(LaunchStatusSchema, (await get(`/api/launch/${launchId}`)).body) as z.infer<typeof LaunchStatusSchema>;
    expect(landed.step).toBe("landed");
    expect(landed.mint).toBeTruthy();

    l.startedAt -= 1000;
    const indexed = expectShape(LaunchStatusSchema, (await get(`/api/launch/${launchId}`)).body) as z.infer<typeof LaunchStatusSchema>;
    expect(indexed.step).toBe("indexed");
    const list = expectShape(CoinListSchema, (await get("/api/coins?sort=new&limit=1")).body) as z.infer<typeof CoinListSchema>;
    expect(list.items[0]!.ticker).toBe("MOONPIG");
  });
});

describe("auth (SIWS) and signed-in routes", () => {
  it("issues a nonce, verifies an ed25519 signature once, and sets an httpOnly cookie", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const address = bs58.encode(raw);
    const n = expectShape(NonceResponseSchema, (await get(`/api/auth/nonce?address=${address}`)).body) as z.infer<typeof NonceResponseSchema>;
    expect(n.message).toContain(address);
    const signature = bs58.encode(sign(null, Buffer.from(n.message), privateKey));

    const wrong = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { address, signature: bs58.encode(Buffer.alloc(64, 1)), nonce: n.nonce } });
    expect(wrong.statusCode).toBe(401);
    // The nonce was consumed by the failed attempt.
    const replay = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { address, signature, nonce: n.nonce } });
    expect(replay.statusCode).toBe(401);

    const n2 = (await get(`/api/auth/nonce?address=${address}`)).body as { nonce: string; message: string };
    const sig2 = bs58.encode(sign(null, Buffer.from(n2.message), privateKey));
    const ok = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { address, signature: sig2, nonce: n2.nonce } });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers["set-cookie"]);
    expect(cookie).toMatch(/divvy_session=.+HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const jar = { cookie: cookie.split(";")[0]! };
    const me = expectShape(MeSchema, (await get("/api/me", jar)).body) as z.infer<typeof MeSchema>;
    expect(me.wallet).toBe(address);
    expectShape(ClaimsSchema, (await get("/api/claims", jar)).body);
    expect((await get("/api/claims")).status).toBe(401);
  });

  it("refuses oversized sign-in fields before decoding them (audit: quadratic base58 decode)", async () => {
    const address = bs58.encode(Buffer.alloc(32, 7));
    const n = (await get(`/api/auth/nonce?address=${address}`)).body as { nonce: string };
    const t = Date.now();
    const r = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { address, signature: "2".repeat(60_000), nonce: n.nonce } });
    expect(r.statusCode).toBe(400);
    expect(Date.now() - t).toBeLessThan(200);
    expect((await get(`/api/auth/nonce?address=${"3".repeat(5000)}`)).status).toBe(400);
  });

  it("answers bad queries with the error contract, never internal error text", async () => {
    const mint = ((await get("/api/coins?limit=1")).body as { items: { mint: string }[] }).items[0]!.mint;
    const r = await get(`/api/coins/${mint}/trades?limit=abc`);
    expect(r.status).toBe(400);
    expectShape(ApiErrorSchema, r.body);
  });

  it("POST /api/trade/build returns a quote in the real shape", async () => {
    const d = (await get("/api/coins/FROG")).body as { mint: string };
    const r = await app.inject({ method: "POST", url: "/api/trade/build", payload: { mint: d.mint, side: "buy", amountIn: "500000000", slippageBps: 100, wallet: "7Hq3Lx9Fa2Mv8RtYbW1Pd5QzJnK4cE6uSgDhA3x9Fa" } });
    const t = expectShape(TradeBuildResponseSchema, r.json()) as z.infer<typeof TradeBuildResponseSchema>;
    expect(BigInt(t.minOut.raw)).toBeLessThan(BigInt(t.expectedOut.raw));
  });
});

describe("env", () => {
  it("refuses to run mock mode in production", () => {
    expect(() => loadEnv({ API_MODE: "mock", NODE_ENV: "production" })).toThrow(/refusing/);
  });
});
