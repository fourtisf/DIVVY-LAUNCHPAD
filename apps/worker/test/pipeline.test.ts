/**
 * Launch pipeline and indexer against real Postgres ("<db>_wtest") and Redis, chain stubbed.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { createPrivateKey, sign } from "node:crypto";
import bs58 from "bs58";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { ComputeBudgetProgram, Keypair, MessageV0, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Connection, type VersionedTransactionResponse } from "@solana/web3.js";
import { PrismaClient } from "@divvy/db";
import { foldName, foldTicker, loadParams } from "@divvy/shared";
import { prismaTxLogger, setLaunchSettings, type PriceCache } from "@divvy/server";
import { EVENT_IX_TAG_LE, POOL_CREATE_EVENT_DISC, programs, TRADE_EVENT_DISC, type PlatformState, type SolanaEnv } from "@divvy/solana/live";
import type { WorkerDeps } from "../src/deps";
import { loadWorkerEnv } from "../src/env";
import { Indexer } from "../src/indexer";
import { failLaunch, mintCreated, processLaunch, reconcileLaunches, signing } from "../src/launch";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

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
  getBlockHeight: async () => 900,
  sendRawTransaction: async () => {
    rpcSends++;
    return "x";
  },
  confirmTransaction: async () => ({ value: { err: null } }),
  getSignaturesForAddress: async () => [],
  getSignatureStatuses: async (sigs: string[]) => ({ value: sigs.map(() => ({ confirmationStatus: "confirmed", err: null })) }),
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
const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
/** The creator's wallet, which signs the create in the browser. */
let creatorKp = Keypair.generate();

/**
 * The browser's side of a launch: whenever the worker asks for the creator's signature, the wallet signs
 * the create (or turns it down, or another key signs it) and the page posts the signature. Returns a
 * stop function.
 */
function wallet(launchId: string, how: "sign" | "refuse" | "wrong-key" | "priority-fee" | "other-tx" | "sign-then-refuse" = "sign") {
  let stop = false;
  let rounds = 0;
  const loop = (async () => {
    while (!stop) {
      const l = await prisma.launch.findUnique({ where: { id: launchId } });
      if (l?.step === "signing" && l.unsignedTx && !l.creatorSigned && !l.signRefused) {
        const act = how === "sign-then-refuse" ? (rounds++ === 0 ? "sign" : "refuse") : how;
        let tx = VersionedTransaction.deserialize(Buffer.from(l.unsignedTx, "base64"));
        // What the wallet gets carries no signature at all: the mint's stays in the worker.
        expect(tx.signatures.every((sig) => sig.every((b) => b === 0))).toBe(true);
        if (act === "refuse") await prisma.launch.update({ where: { id: launchId }, data: { signRefused: true } });
        else {
          if (act === "priority-fee" || act === "other-tx") {
            // A wallet that adds its own priority fee (or, for "other-tx", slips in a transfer).
            const m = TransactionMessage.decompile(tx.message);
            m.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
            if (act === "other-tx") m.instructions.push(SystemProgram.transfer({ fromPubkey: creatorKp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
            tx = new VersionedTransaction(m.compileToV0Message());
          }
          const kp = act === "wrong-key" ? Keypair.generate() : creatorKp;
          const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, Buffer.from(kp.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
          tx.signatures[0] = sign(null, tx.message.serialize(), key);
          await prisma.launch.update({ where: { id: launchId }, data: { creatorSigned: Buffer.from(tx.serialize()).toString("base64") } });
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  return () => {
    stop = true;
    return loop;
  };
}

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
    creatorKp = Keypair.generate();
    userId = (await prisma.user.create({ data: { wallet: creatorKp.publicKey.toBase58() } })).id;
    signing.waitMs = 2000;
    signing.pollMs = 10;
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
    const done = wallet(launch.id);
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), launch.id);
    await done();
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
    // Paid and signed by the creator's wallet (the coin's dev on explorers) and signed by the mint.
    expect(keys[0]).toBe(creatorKp.publicKey.toBase58());
    expect(keys).not.toContain(launcher.publicKey.toBase58());
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
    expect(await prisma.signedTx.findMany({ select: { purpose: true, signer: true, bundleId: true } })).toEqual([{ purpose: "launch.create", signer: "creator", bundleId: "bundle-1" }]);
    expect(l.unsignedTx).toBeNull();
  });

  it("puts uspad's launch fee inside the creator's create, and none for an admin", async () => {
    const feeWallet = Keypair.generate().publicKey;
    const paid = (params = loadParams({})) => {
      const d = deps({ cluster: "mainnet-beta", mainnetEnabled: true });
      return { ...d, params, env: { ...d.env, LAUNCH_FEE_LAMPORTS: 20_000_000n, LAUNCH_FEE_WALLET: feeWallet.toBase58() } };
    };
    const transfers = (b64: string) => {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      const k = tx.message.staticAccountKeys;
      return tx.message.compiledInstructions
        .filter((ix) => k[ix.programIdIndex]!.equals(SystemProgram.programId))
        .map((ix) => ({ from: k[ix.accountKeyIndexes[0]!]!.toBase58(), to: k[ix.accountKeyIndexes[1]!]!.toBase58(), lamports: Buffer.from(ix.data).readBigUInt64LE(4) }));
    };
    const { launch } = await pendingLaunch("FEE");
    let done = wallet(launch.id);
    await processLaunch(paid(), launch.id);
    await done();
    const me = creatorKp.publicKey.toBase58();
    expect(transfers(bundles[0]![0]!)).toEqual([
      { from: me, to: feeWallet.toBase58(), lamports: 20_000_000n },
      { from: me, to: tipAccount.toBase58(), lamports: 100_000n },
    ]);
    expect((await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } })).feeLamports).toBe(20_000_000n);

    const { coin, launch: admins } = await pendingLaunch("FREE2");
    done = wallet(admins.id);
    await processLaunch(paid(loadParams({ ADMIN_WALLETS: coin.creatorWallet })), admins.id);
    await done();
    expect(transfers(bundles[1]![0]!)).toEqual([{ from: me, to: tipAccount.toBase58(), lamports: 100_000n }]);
  });

  it("a creator who turns the create down in their wallet is charged nothing", async () => {
    const { coin, launch } = await pendingLaunch("NOPE");
    const done = wallet(launch.id, "refuse");
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), launch.id);
    await done();
    const l = await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } });
    expect(l).toMatchObject({ step: "failed", error: { code: "LAUNCH_CANCELLED" }, unsignedTx: null });
    expect(bundles).toHaveLength(0);
    expect((await prisma.coin.findUniqueOrThrow({ where: { id: coin.id } })).status).toBe("failed");
  });

  it("a signature from another key doesn't send the create; unapproved rounds end the launch", async () => {
    signing.waitMs = 150;
    const { launch } = await pendingLaunch("FAKE");
    const done = wallet(launch.id, "wrong-key");
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), launch.id);
    await done();
    expect(await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } })).toMatchObject({ step: "failed", error: { code: "LAUNCH_NOT_APPROVED" } });
    expect(bundles).toHaveLength(0);
    expect(await prisma.signedTx.count()).toBe(0);
  });

  it("takes a create the wallet gave a priority fee, and refuses one it changed otherwise", async () => {
    const { launch } = await pendingLaunch("PRIO");
    let done = wallet(launch.id, "priority-fee");
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), launch.id);
    await done();
    expect((await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } })).step).toBe("indexed");
    const sent = VersionedTransaction.deserialize(Buffer.from(bundles[0]![0]!, "base64"));
    // The wallet's message (its priority fee added to the limit, the create and the tip), signed by the creator and then by the mint.
    expect(sent.message.compiledInstructions).toHaveLength(4);
    expect(sent.signatures.filter((s) => s.some((b) => b !== 0))).toHaveLength(2);

    signing.waitMs = 150;
    const { launch: other } = await pendingLaunch("SNEAK");
    done = wallet(other.id, "other-tx");
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), other.id);
    await done();
    expect(await prisma.launch.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ step: "failed", error: { code: "LAUNCH_NOT_APPROVED" } });
    expect(bundles).toHaveLength(1);
  });

  it("the reconciler ends a launch whose worker stopped while waiting for the signature", async () => {
    const { launch } = await pendingLaunch("GONE");
    await prisma.launch.update({ where: { id: launch.id }, data: { step: "signing", unsignedTx: "x", updatedAt: new Date(Date.now() - 6 * 60_000) } });
    await reconcileLaunches(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), async () => {});
    expect(await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } })).toMatchObject({ step: "failed", unsignedTx: null });
  });

  it("a bundle that hasn't landed leaves the launch to the reconciler instead of failing it (audit)", async () => {
    const { coin, launch } = await pendingLaunch("SLOW");
    const slowJito = { ...jito, waitForBundle: async () => ({ bundle_id: "b", status: "Invalid", landed_slot: null }) } as unknown as WorkerDeps["jito"];
    const done = wallet(launch.id);
    await processLaunch({ ...deps({ cluster: "mainnet-beta", mainnetEnabled: true }), jito: slowJito }, launch.id);
    await done();
    expect((await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } })).step).toBe("bundling");
    // The identity stays reserved: the create could still land until its blockhash expires.
    expect((await prisma.coin.findUniqueOrThrow({ where: { id: coin.id } })).tickerNorm).toBe(foldTicker("SLOW"));
    // Each new attempt was signed again by the creator.
    expect(bundles).toHaveLength(3);
  }, 30_000);

  it("turning down a later round leaves a create already sent to the reconciler (audit)", async () => {
    const { launch } = await pendingLaunch("LATE");
    const slowJito = { ...jito, waitForBundle: async () => ({ bundle_id: "b", status: "Invalid", landed_slot: null }) } as unknown as WorkerDeps["jito"];
    const done = wallet(launch.id, "sign-then-refuse");
    await processLaunch({ ...deps({ cluster: "mainnet-beta", mainnetEnabled: true }), jito: slowJito }, launch.id);
    await done();
    // The first create may still land until its blockhash expires: not failed, waiting on that blockhash.
    const l = await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } });
    expect(l.step).toBe("bundling");
    expect(l.lastValidBlockHeight).toBe(1000n);
    expect(bundles).toHaveLength(1);
  }, 30_000);

  it("a bare transfer to the mint's address isn't a landed create (audit)", async () => {
    const mint = Keypair.generate().publicKey;
    const at = (owner: PublicKey, len: number) => ({ getAccountInfo: async () => ({ owner, data: Buffer.alloc(len), lamports: 1, executable: false }) }) as unknown as Connection;
    expect(await mintCreated(at(SystemProgram.programId, 0), mint)).toBe(false);
    expect(await mintCreated(at(TOKEN_2022_PROGRAM_ID, 0), mint)).toBe(false);
    expect(await mintCreated(at(TOKEN_2022_PROGRAM_ID, 82), mint)).toBe(true);
  });

  it("while launches are paused, only an admin's launch goes out", async () => {
    await setLaunchSettings(prisma, { launchesOpen: false, reason: "Launches open soon." });
    const { launch } = await pendingLaunch("SHUT");
    await processLaunch(deps({ cluster: "mainnet-beta", mainnetEnabled: true }), launch.id);
    expect((await prisma.launch.findUniqueOrThrow({ where: { id: launch.id } })).error).toMatchObject({ code: "LAUNCHES_PAUSED", message: "Launches open soon." });
    expect(bundles).toHaveLength(0);

    const { coin, launch: mine } = await pendingLaunch("TEST");
    const done = wallet(mine.id);
    await processLaunch({ ...deps({ cluster: "mainnet-beta", mainnetEnabled: true }), params: loadParams({ ADMIN_WALLETS: coin.creatorWallet }) }, mine.id);
    await done();
    expect((await prisma.launch.findUniqueOrThrow({ where: { id: mine.id } })).step).not.toBe("failed");
    expect(bundles).toHaveLength(1);
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
    const fee = await prisma.launchFee.create({ data: { userId: launch.userId, sig: "feesig-free", lamports: 20_000_000n, launchId: launch.id } });
    await failLaunch(deps({}), launch.id, "LAUNCH_FAILED", "nope");
    const c = await prisma.coin.findUniqueOrThrow({ where: { id: coin.id } });
    expect(c).toMatchObject({ status: "failed", ticker: "FREE", creatorXUserId: null });
    expect(c.tickerNorm).not.toBe(foldTicker("FREE"));
    // The creator's launch fee is free again, as credit for their next launch.
    expect((await prisma.launchFee.findUniqueOrThrow({ where: { id: fee.id } })).launchId).toBeNull();
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
