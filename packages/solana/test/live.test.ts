import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BN from "bn.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { Connection, Keypair, MessageV0, PublicKey, VersionedTransaction, type VersionedTransactionResponse } from "@solana/web3.js";
import { Curve, LaunchpadPool, PlatformConfig } from "@raydium-io/raydium-sdk-v2";
import {
  assertCanSend,
  createTransaction,
  decodeTradeEvent,
  EVENT_IX_TAG_LE,
  EventLayoutError,
  JitoClient,
  JupiterClient,
  loadKeypair,
  MainnetDisabledError,
  parseLaunchLabTransaction,
  poolAddresses,
  programs,
  quoteBuy,
  quoteSell,
  snapshotHolders,
  TRADE_EVENT_DISC,
  type GlobalConfigState,
  type PoolState,
} from "../src/live";
import { LAUNCHLAB_DEFAULT_CURVE } from "../src";

const P = programs("mainnet-beta");

type EventOverrides = { pool: PublicKey; dir?: number; status?: number } & Partial<Record<"totalBaseSell" | "virtualBase" | "virtualQuote" | "realBaseBefore" | "realQuoteBefore" | "realBaseAfter" | "realQuoteAfter" | "amountIn" | "amountOut" | "protocolFee" | "platformFee" | "creatorFee" | "shareFee", bigint>>;

function tradeEventBody(o: EventOverrides): Buffer {
  const b = Buffer.alloc(139);
  o.pool.toBuffer().copy(b, 0);
  const vals = [
    o.totalBaseSell ?? 793_100_000_000_000n, o.virtualBase ?? 1_073_025_605_596_382n, o.virtualQuote ?? 30_000_852_951n,
    o.realBaseBefore ?? 0n, o.realQuoteBefore ?? 0n, o.realBaseAfter ?? 35_000_000_000_000n, o.realQuoteAfter ?? 990_000_000n,
    o.amountIn ?? 1_000_000_000n, o.amountOut ?? 35_000_000_000_000n, o.protocolFee ?? 2_500_000n, o.platformFee ?? 6_000_000n,
    o.creatorFee ?? 1_500_000n, o.shareFee ?? 0n,
  ];
  vals.forEach((v, i) => b.writeBigUInt64LE(v, 32 + i * 8));
  b[136] = Number(o.dir ?? 0);
  b[137] = Number(o.status ?? 0);
  b[138] = 1;
  return b;
}

describe("TradeEvent decoding", () => {
  const pool = Keypair.generate().publicKey;
  it("decodes the IDL layout", () => {
    const e = decodeTradeEvent(tradeEventBody({ pool }));
    expect(e.poolState.equals(pool)).toBe(true);
    expect(e.side).toBe("buy");
    expect(e.platformFee).toBe(6_000_000n);
    expect(e.exactIn).toBe(true);
  });
  it("rejects data that doesn't look like a TradeEvent", () => {
    expect(() => decodeTradeEvent(tradeEventBody({ pool, dir: 7 }))).toThrow(EventLayoutError);
    expect(() => decodeTradeEvent(tradeEventBody({ pool, platformFee: 900_000_000n }))).toThrow(EventLayoutError);
    expect(() => decodeTradeEvent(Buffer.alloc(20))).toThrow(EventLayoutError);
  });
});

describe("parseLaunchLabTransaction", () => {
  it("finds the event CPI, the trader and the pool", () => {
    const trader = Keypair.generate().publicKey;
    const pool = Keypair.generate().publicKey;
    const keys = [trader, P.launchLab, pool];
    const buyDisc = Buffer.from([250, 234, 13, 123, 213, 156, 19, 236]); // sha256("global:buy_exact_in")[..8], IDL
    const message = new MessageV0({
      header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
      staticAccountKeys: keys,
      recentBlockhash: bs58.encode(Buffer.alloc(32, 1)),
      compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0, 2], data: Buffer.concat([buyDisc, Buffer.alloc(24)]) }],
      addressTableLookups: [],
    });
    const eventData = Buffer.concat([EVENT_IX_TAG_LE, TRADE_EVENT_DISC, tradeEventBody({ pool })]);
    const tx = {
      slot: 1,
      transaction: { message, signatures: ["x"] },
      meta: {
        err: null,
        fee: 5000,
        preBalances: [],
        postBalances: [],
        loadedAddresses: { writable: [], readonly: [] },
        innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 1, accounts: [1], data: bs58.encode(eventData) }] }],
      },
    } as unknown as VersionedTransactionResponse;
    const r = parseLaunchLabTransaction(tx, P.launchLab, P.cpmm);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.trader?.equals(trader)).toBe(true);
    expect(r.trades[0]!.event.poolState.equals(pool)).toBe(true);
  });
});

function freshPool(): { pool: PoolState; config: GlobalConfigState } {
  const c = LAUNCHLAB_DEFAULT_CURVE;
  const init = Curve.getCurve(0).getInitParam({
    supply: new BN(c.supply.toString()),
    totalFundRaising: new BN(c.totalFundRaisingB.toString()),
    totalSell: new BN(c.totalSellA.toString()),
    totalLockedAmount: new BN(0),
    migrateFee: new BN(0),
  });
  const pool = LaunchpadPool.decode(Buffer.alloc(LaunchpadPool.span));
  Object.assign(pool, {
    supply: new BN(c.supply.toString()),
    totalSellA: init.c,
    virtualA: init.a,
    virtualB: init.b,
    realA: new BN(0),
    realB: new BN(0),
    totalFundRaisingB: new BN(c.totalFundRaisingB.toString()),
  });
  return { pool, config: { curveType: 0, tradeFeeRate: new BN(2500) } as GlobalConfigState };
}

describe("quotes (SDK curve math)", () => {
  const rates = { protocol: new BN(2500), platform: new BN(6000), creator: new BN(1500) };
  it("splits a 1 SOL buy into 0.25% / 0.60% / 0.15%", () => {
    const { pool, config } = freshPool();
    const q = quoteBuy(pool, config, rates, new BN(1_000_000_000));
    expect(q.platformFee.toNumber()).toBe(6_000_000);
    expect(q.creatorFee.toNumber()).toBe(1_500_000);
    expect(q.protocolFee.toNumber()).toBe(2_500_000);
    expect(q.amountOut.gtn(0)).toBe(true);
  });
  it("a sell returns less SOL than the buy cost", () => {
    const { pool, config } = freshPool();
    const q = quoteBuy(pool, config, rates, new BN(1_000_000_000));
    pool.realA = q.amountOut;
    pool.realB = new BN(1_000_000_000).sub(q.platformFee).sub(q.creatorFee).sub(q.protocolFee);
    const s = quoteSell(pool, config, rates, q.amountOut);
    expect(s.amountOut.lt(new BN(1_000_000_000))).toBe(true);
  });
});

describe("create transaction", () => {
  it("is signed by the launcher and the mint only, with the tip inside and Option::None trimmed", () => {
    const launcher = Keypair.generate();
    const mint = Keypair.generate();
    const creator = Keypair.generate().publicKey;
    const tipAccount = Keypair.generate().publicKey;
    const platform = PlatformConfig.decode(Buffer.alloc(PlatformConfig.span));
    const c = LAUNCHLAB_DEFAULT_CURVE;
    const tx = createTransaction({
      programId: P.launchLab,
      payer: launcher.publicKey,
      payerKeypair: launcher,
      creator,
      globalConfig: P.defaultGlobalConfig,
      platformId: Keypair.generate().publicKey,
      platform,
      mint: mint.publicKey,
      mintKeypair: mint,
      name: "Moon Pig",
      symbol: "MOONPIG",
      uri: "https://example.invalid/m.json",
      supply: new BN(c.supply.toString()),
      totalSellA: new BN(c.totalSellA.toString()),
      totalFundRaisingB: new BN(c.totalFundRaisingB.toString()),
      recentBlockhash: bs58.encode(Buffer.alloc(32, 7)),
      tip: { account: tipAccount, lamports: 100_000 },
    });
    const msg = tx.message;
    expect(msg.header.numRequiredSignatures).toBe(2);
    const signers = msg.staticAccountKeys.slice(0, 2).map((k) => k.toBase58());
    expect(signers).toContain(launcher.publicKey.toBase58());
    expect(signers).toContain(mint.publicKey.toBase58());
    expect(signers).not.toContain(creator.toBase58());
    expect(msg.staticAccountKeys.map((k) => k.toBase58())).toContain(tipAccount.toBase58());
    const createIx = msg.compiledInstructions.find((i) => msg.staticAccountKeys[i.programIdIndex]!.equals(P.launchLab))!;
    expect(createIx.data[createIx.data.length - 1]).toBe(0); // Option::None tag is the last byte
    expect(tx.serialize().length).toBeLessThanOrEqual(1232);
    const { poolId } = poolAddresses(P.launchLab, mint.publicKey);
    expect(msg.staticAccountKeys.map((k) => k.toBase58())).toContain(poolId.toBase58());
    expect(VersionedTransaction.deserialize(tx.serialize()).signatures).toHaveLength(2);
  });
});

describe("mainnet gate", () => {
  it("blocks mainnet sends until enabled", () => {
    expect(() => assertCanSend({ cluster: "mainnet-beta", mainnetEnabled: false }, "payout.swap")).toThrow(MainnetDisabledError);
    expect(() => assertCanSend({ cluster: "mainnet-beta", mainnetEnabled: true }, "payout.swap")).not.toThrow();
    expect(() => assertCanSend({ cluster: "devnet", mainnetEnabled: false }, "payout.swap")).not.toThrow();
  });
});

describe("loadKeypair", () => {
  it("refuses files readable by others and accepts chmod 600", () => {
    const dir = mkdtempSync(join(tmpdir(), "divvy-keys-"));
    const f = join(dir, "k.json");
    writeFileSync(f, JSON.stringify(Array.from(Keypair.generate().secretKey)));
    chmodSync(f, 0o644);
    expect(() => loadKeypair(f, "launcher")).toThrow(/chmod 600/);
    chmodSync(f, 0o600);
    expect(loadKeypair(f, "launcher").publicKey).toBeInstanceOf(PublicKey);
    writeFileSync(f, "[1,2,3]");
    expect(() => loadKeypair(f, "launcher")).toThrow(/64-byte/);
  });
});

describe("JitoClient", () => {
  it("sends base64 bundles to /api/v1/bundles and enforces the minimum tip", async () => {
    const calls: { url: string; body: { method: string; params: unknown[] } }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      const result = body.method === "getTipAccounts" ? [Keypair.generate().publicKey.toBase58()] : "bundle-id";
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    }) as typeof fetch;
    const j = new JitoClient("https://jito.invalid", undefined, fake);
    expect(await j.sendBundle(["AAAA"])).toBe("bundle-id");
    expect(calls[0]!.url).toBe("https://jito.invalid/api/v1/bundles");
    expect(calls[0]!.body.params).toEqual([["AAAA"], { encoding: "base64" }]);
    await expect(j.tipInstruction(Keypair.generate().publicKey, 999)).rejects.toThrow(/at least 1000/);
    expect(() => j.sendBundle(["a", "b", "c", "d", "e", "f"])).toThrow();
  }, 10_000);
});

describe("JupiterClient.build", () => {
  it("adds a CU limit and converts the price impact ratio to bps", async () => {
    const prog = Keypair.generate().publicKey.toBase58();
    const ix = { programId: prog, accounts: [{ pubkey: prog, isSigner: false, isWritable: true }], data: Buffer.from([1, 2]).toString("base64") };
    const fake = (async (url: string) => {
      expect(url).toContain("/swap/v2/build?");
      expect(url).toContain("forJitoBundle=true");
      return new Response(
        JSON.stringify({
          inputMint: "a", outputMint: "b", inAmount: "1000", outAmount: "500", otherAmountThreshold: "495", slippageBps: 100, priceImpactPct: "0.0123",
          computeBudgetInstructions: [], setupInstructions: [ix], swapInstruction: ix, cleanupInstruction: null, otherInstructions: [], addressesByLookupTableAddress: null,
        }),
      );
    }) as typeof fetch;
    const r = await new JupiterClient("https://jup.invalid", undefined, fake).build({ inputMint: "a", outputMint: "b", amount: 1000n, taker: Keypair.generate().publicKey, slippageBps: 100, forJitoBundle: true });
    expect(r.priceImpactBps).toBe(123);
    expect(r.minOut).toBe(495n);
    expect(r.instructions).toHaveLength(3);
  });
});

describe("snapshotHolders (DAS)", () => {
  it("sums accounts per owner, skips frozen ones and keeps u64 precision", async () => {
    const pages = [
      { cursor: "c1", token_accounts: [{ owner: "A", amount: "9007199254740993" }, { owner: "B", amount: 5 }, { owner: "A", amount: 2 }] },
      { cursor: null, token_accounts: [{ owner: "C", amount: 7, frozen: true }] },
    ];
    let i = 0;
    const fake = (async () => new Response(JSON.stringify({ result: pages[i++] }).replace(/"amount":"(\d+)"/g, '"amount":$1'))) as typeof fetch;
    const conn = new Connection("https://rpc.invalid");
    const h = await snapshotHolders(conn, Keypair.generate().publicKey, Keypair.generate().publicKey, { fetchImpl: fake });
    expect(h).toEqual([
      { owner: "A", amount: 9007199254740995n },
      { owner: "B", amount: 5n },
    ]);
  });
});
