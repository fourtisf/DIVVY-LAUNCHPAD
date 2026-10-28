import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BN from "bn.js";
import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";
import { Connection, Keypair, MessageV0, PublicKey, SystemProgram, VersionedTransaction, type VersionedTransactionResponse } from "@solana/web3.js";
import { Curve, LaunchpadPool, PlatformConfig } from "@raydium-io/raydium-sdk-v2";
import {
  assertCanSend,
  createTransaction,
  CreateTooLargeError,
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
  CPMM_SWAP_EVENT_DISC,
  CPMM_SWAP_EVENT_LEN,
  cpmmPoolPda,
  parseCpmmSwaps,
  getTransactionAnyVersion,
  TxShapeError,
  unsupportedVersionOf,
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

describe("TradeEvent sanity on tiny trades (audit)", () => {
  const pool = Keypair.generate().publicKey;
  it("accepts a 9-lamport buy whose rounded-up fee is over 10% of it", () => {
    const e = decodeTradeEvent(tradeEventBody({ pool, amountIn: 9n, amountOut: 1000n, realBaseAfter: 1000n, protocolFee: 0n, platformFee: 1n, creatorFee: 0n }));
    expect(e.platformFee).toBe(1n);
  });
  it("still rejects fees larger than the trade", () => {
    expect(() => decodeTradeEvent(tradeEventBody({ pool, amountIn: 9n, amountOut: 1000n, realBaseAfter: 1000n, protocolFee: 5n, platformFee: 6n, creatorFee: 0n }))).toThrow(EventLayoutError);
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

    // Another platform's pool: not decoded at all, so its events can't stop the indexer.
    expect(parseLaunchLabTransaction(tx, P.launchLab, P.cpmm, () => false).trades).toHaveLength(0);
    const garbage = Buffer.concat([EVENT_IX_TAG_LE, TRADE_EVENT_DISC, tradeEventBody({ pool, dir: 9 })]);
    const other = { ...tx, meta: { ...tx.meta!, innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 1, accounts: [1], data: bs58.encode(garbage) }] }] } } as VersionedTransactionResponse;
    expect(() => parseLaunchLabTransaction(other, P.launchLab, P.cpmm)).toThrow(EventLayoutError);
    expect(parseLaunchLabTransaction(other, P.launchLab, P.cpmm, (p) => p !== pool.toBase58()).trades).toHaveLength(0);

    // A trade instruction that produced no TradeEvent means the program changed: stop, don't skip.
    const silent = { ...tx, meta: { ...tx.meta!, innerInstructions: [] } } as VersionedTransactionResponse;
    expect(() => parseLaunchLabTransaction(silent, P.launchLab, P.cpmm)).toThrow(EventLayoutError);
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

describe("getTransactionAnyVersion (transaction versions web3.js can't read)", () => {
  const trader = Keypair.generate().publicKey;
  const pool = Keypair.generate().publicKey;
  const buyDisc = Buffer.from([250, 234, 13, 123, 213, 156, 19, 236]);
  const eventData = Buffer.concat([EVENT_IX_TAG_LE, TRADE_EVENT_DISC, tradeEventBody({ pool })]);
  // What the RPC returns for getTransaction with encoding "json".
  const json = {
    slot: 7,
    blockTime: 1_800_000_000,
    version: 1,
    transaction: {
      signatures: ["sig"],
      message: {
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 },
        accountKeys: [trader, P.launchLab, pool].map((k) => k.toBase58()),
        recentBlockhash: bs58.encode(Buffer.alloc(32, 1)),
        instructions: [{ programIdIndex: 1, accounts: [0, 2], data: bs58.encode(Buffer.concat([buyDisc, Buffer.alloc(24)])), stackHeight: 1 }],
      },
    },
    meta: { err: null, fee: 5000, logMessages: [], innerInstructions: [{ index: 0, instructions: [{ programIdIndex: 1, accounts: [1], data: bs58.encode(eventData), stackHeight: 2 }] }] },
  };
  const unsupported = Object.assign(
    new Error('failed to get transaction: Transaction version (1) is not supported by the requesting client. Please try the request again with the following configuration parameter: "maxSupportedTransactionVersion": 1'),
    { code: -32015 },
  );
  const conn = (err: Error) => ({ rpcEndpoint: "http://rpc.test", getTransaction: async () => Promise.reject(err) }) as unknown as Connection;
  const serve = (result: unknown) => {
    const bodies: { params: [string, { maxSupportedTransactionVersion: number; encoding: string }] }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });
    return bodies;
  };

  it("asks again for that version and parses its trade like any other", async () => {
    const bodies = serve(json);
    try {
      const tx = await getTransactionAnyVersion(conn(unsupported), "sig");
      expect(bodies[0]!.params[1]).toMatchObject({ maxSupportedTransactionVersion: 1, encoding: "json" });
      expect(tx!.slot).toBe(7);
      expect(tx!.transaction.message.staticAccountKeys[0]!.equals(trader)).toBe(true);
      const r = parseLaunchLabTransaction(tx!, P.launchLab, P.cpmm);
      expect(r.trades).toHaveLength(1);
      expect(r.trades[0]!.trader?.equals(trader)).toBe(true);
      expect(r.trades[0]!.event.poolState.equals(pool)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops on a shape it doesn't know instead of skipping the transaction", async () => {
    serve({ ...json, transaction: { signatures: ["sig"], message: { staticKeys: [] } } });
    try {
      await expect(getTransactionAnyVersion(conn(unsupported), "sig")).rejects.toBeInstanceOf(TxShapeError);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes other RPC errors through", async () => {
    const bodies = serve(json);
    try {
      await expect(getTransactionAnyVersion(conn(new Error("429 Too Many Requests")), "sig")).rejects.toThrow("429");
      expect(bodies).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reads the version from the error", () => {
    expect(unsupportedVersionOf(unsupported)).toBe(1);
    expect(unsupportedVersionOf(new Error("Transaction version (2) is not supported by the requesting client"))).toBe(2);
    expect(unsupportedVersionOf(new Error("failed to get transaction: Node is behind"))).toBeNull();
  });
});

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

  const creatorCreate = (o: { name: string; devBuyLamports?: bigint }) => {
    const creator = Keypair.generate().publicKey;
    const mint = Keypair.generate();
    const c = LAUNCHLAB_DEFAULT_CURVE;
    const tx = createTransaction({
      programId: P.launchLab,
      payer: creator,
      creator,
      globalConfig: P.defaultGlobalConfig,
      platformId: Keypair.generate().publicKey,
      platform: PlatformConfig.decode(Buffer.alloc(PlatformConfig.span)),
      mint: mint.publicKey,
      mintKeypair: mint,
      name: o.name,
      symbol: "ABCDEFGHIJ",
      // A local-storage metadata link as the worker writes it (meta/<coin id>.json).
      uri: "https://uspad.fun/api/media/files/meta/cmhaaaaaaaaaaaaaaaaaaaaaa.json",
      supply: new BN(c.supply.toString()),
      totalSellA: new BN(c.totalSellA.toString()),
      totalFundRaisingB: new BN(c.totalFundRaisingB.toString()),
      recentBlockhash: bs58.encode(Buffer.alloc(32, 7)),
      tip: { account: Keypair.generate().publicKey, lamports: 100_000 },
      fee: { to: Keypair.generate().publicKey, lamports: 100_000_000n },
      devBuyLamports: o.devBuyLamports,
    });
    return { tx, creator, mint: mint.publicKey };
  };

  it("puts the creator's dev buy right after the create, in the same transaction", () => {
    const { tx, creator, mint } = creatorCreate({ name: "A".repeat(32), devBuyLamports: 1_500_000_000n });
    const msg = tx.message;
    const keys = msg.staticAccountKeys;
    expect(keys[0]!.equals(creator)).toBe(true);
    // The longest ASCII name and ticker still fit (1219 bytes), with room for a wallet's 12-byte priority fee.
    expect(tx.serialize().length).toBeLessThanOrEqual(1232 - 12);
    const progs = msg.compiledInstructions.map((i) => keys[i.programIdIndex]!.toBase58());
    const create = progs.indexOf(P.launchLab.toBase58());
    const buy = progs.lastIndexOf(P.launchLab.toBase58());
    expect(buy).toBeGreaterThan(create);
    const ix = msg.compiledInstructions[buy]!;
    // buy_exact_in: amount_b (u64) at 8, min_amount_a at 16; account 0 the buyer, 9 the coin's mint.
    expect(Buffer.from(ix.data).readBigUInt64LE(8)).toBe(1_500_000_000n);
    expect(keys[ix.accountKeyIndexes[0]!]!.equals(creator)).toBe(true);
    expect(keys[ix.accountKeyIndexes[9]!]!.equals(mint)).toBe(true);
    // The SOL goes into the creator's own WSOL account, which is closed again after the buy.
    const transfers = msg.compiledInstructions.filter((i) => keys[i.programIdIndex]!.equals(SystemProgram.programId) && Buffer.from(i.data).readUInt32LE(0) === 2);
    expect(transfers.map((i) => Buffer.from(i.data).readBigUInt64LE(4))).toContain(1_500_000_000n);
  });

  it("refuses a create with a dev buy that doesn't fit one transaction", () => {
    expect(() => creatorCreate({ name: "🚀".repeat(32), devBuyLamports: 1_000_000_000n })).toThrow(CreateTooLargeError);
    expect(() => creatorCreate({ name: "🚀".repeat(32) })).not.toThrow();
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

describe("CPMM swaps", () => {
  const poolId = Keypair.generate().publicKey;
  const coin = Keypair.generate().publicKey;
  const wsol = new PublicKey("So11111111111111111111111111111111111111112");
  function swapEventData(): Buffer {
    const b = Buffer.alloc(CPMM_SWAP_EVENT_LEN);
    let o = 0;
    poolId.toBuffer().copy(b, o);
    o += 32;
    for (const v of [1_000n, 2_000n, 500_000_000n, 2_000_000n, 0n, 0n]) {
      b.writeBigUInt64LE(v, o);
      o += 8;
    }
    b[o++] = 1;
    wsol.toBuffer().copy(b, o);
    o += 32;
    coin.toBuffer().copy(b, o);
    o += 32;
    b.writeBigUInt64LE(1_250_000n, o);
    o += 8;
    b.writeBigUInt64LE(250_000n, o);
    o += 8;
    b[o] = 1;
    return Buffer.concat([CPMM_SWAP_EVENT_DISC, b]);
  }
  const txWith = (logs: string[]) => ({ slot: 1, transaction: { message: {}, signatures: ["x"] }, meta: { err: null, logMessages: logs } }) as unknown as VersionedTransactionResponse;

  it("decodes SwapEvent from the CPMM program's own log lines", () => {
    const data = swapEventData().toString("base64");
    const r = parseCpmmSwaps(txWith([`Program ${P.cpmm.toBase58()} invoke [2]`, `Program data: ${data}`, `Program ${P.cpmm.toBase58()} success`]), P.cpmm);
    expect(r).toHaveLength(1);
    expect(r[0]!.event).toMatchObject({ inputAmount: 500_000_000n, outputAmount: 2_000_000n, baseInput: true, tradeFee: 1_250_000n, creatorFee: 250_000n, creatorFeeOnInput: true });
    expect(r[0]!.event.poolId.equals(poolId)).toBe(true);
    expect(r[0]!.event.outputMint.equals(coin)).toBe(true);
  });
  it("ignores look-alike lines printed by other programs", () => {
    const data = swapEventData().toString("base64");
    const other = Keypair.generate().publicKey.toBase58();
    const r = parseCpmmSwaps(
      txWith([`Program ${P.cpmm.toBase58()} invoke [1]`, `Program ${other} invoke [2]`, `Program data: ${data}`, `Program ${other} success`, `Program ${P.cpmm.toBase58()} success`]),
      P.cpmm,
    );
    expect(r).toHaveLength(0);
  });
  it("derives the pool PDA independent of mint order", () => {
    const cfg = Keypair.generate().publicKey;
    expect(cpmmPoolPda(P.cpmm, cfg, coin, wsol).equals(cpmmPoolPda(P.cpmm, cfg, wsol, coin))).toBe(true);
  });
});
