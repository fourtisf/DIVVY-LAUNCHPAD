import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { checkCreate, checkTransaction, UnsafeTransaction } from "./txcheck";

const JUPITER = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const LAUNCHLAB = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const ata = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), mint.toBuffer()], ATA)[0];

const wallet = Keypair.generate().publicKey;
const coin = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();

function tx(payer: PublicKey, ixs: TransactionInstruction[], tables: AddressLookupTableAccount[] = []) {
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(tables));
}

function table(addresses: PublicKey[]) {
  return new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses },
  });
}

const wrap = (lamports: number) => SystemProgram.transfer({ fromPubkey: wallet, toPubkey: ata(wallet, WSOL), lamports });

describe("checkTransaction", () => {
  it("passes a Jupiter route compiled with address lookup tables (graduated coins)", () => {
    const routeAccounts = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
    const route = new TransactionInstruction({
      programId: JUPITER,
      keys: [{ pubkey: wallet, isSigner: true, isWritable: true }, ...routeAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }))],
      data: Buffer.from([1, 2, 3]),
    });
    const t = tx(wallet, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), wrap(1000), route], [table(routeAccounts)]);
    expect(t.message.addressTableLookups.length).toBe(1);
    expect(() => checkTransaction(t, wallet, "mainnet-beta", "trade", coin)).not.toThrow();
  });

  it("passes a curve buy that names the coin", () => {
    const buy = new TransactionInstruction({ programId: LAUNCHLAB, keys: [{ pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: coin, isSigner: false, isWritable: false }], data: Buffer.alloc(8) });
    expect(() => checkTransaction(tx(wallet, [wrap(1000), buy]), wallet, "mainnet-beta", "trade", coin)).not.toThrow();
  });

  it("refuses a SOL transfer to someone else", () => {
    const steal = SystemProgram.transfer({ fromPubkey: wallet, toPubkey: Keypair.generate().publicKey, lamports: 1 });
    expect(() => checkTransaction(tx(wallet, [steal]), wallet, "mainnet-beta", "trade")).toThrow(/SOL transfer to someone else/);
  });

  it("refuses an unknown program, and Jupiter without lookup tables or outside a trade", () => {
    const odd = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) });
    expect(() => checkTransaction(tx(wallet, [odd]), wallet, "mainnet-beta", "trade")).toThrow(/unexpected program/);
    const jup = new TransactionInstruction({ programId: JUPITER, keys: [], data: Buffer.alloc(0) });
    expect(() => checkTransaction(tx(wallet, [jup]), wallet, "mainnet-beta", "trade")).toThrow(/unexpected program/);
  });

  it("refuses a trade for a different coin and one paid by someone else", () => {
    const other = new TransactionInstruction({ programId: LAUNCHLAB, keys: [{ pubkey: wallet, isSigner: true, isWritable: true }], data: Buffer.alloc(8) });
    expect(() => checkTransaction(tx(wallet, [other]), wallet, "mainnet-beta", "trade", coin)).toThrow(/different coin/);
    const payer = Keypair.generate().publicKey;
    expect(() => checkTransaction(tx(payer, [other]), wallet, "mainnet-beta", "trade")).toThrow(/another account would pay/);
  });

  it("passes a claim paid into your own token account and refuses one paid elsewhere", () => {
    const vault = Keypair.generate().publicKey;
    const stock = Keypair.generate().publicKey;
    const transfer = (dest: PublicKey) =>
      new TransactionInstruction({
        programId: TOKEN,
        keys: [
          { pubkey: ata(vault, stock), isSigner: false, isWritable: true },
          { pubkey: stock, isSigner: false, isWritable: false },
          { pubkey: dest, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: true, isWritable: false },
          { pubkey: wallet, isSigner: true, isWritable: false },
        ],
        data: Buffer.from([12, 1, 0, 0, 0, 0, 0, 0, 0, 6]),
      });
    expect(() => checkTransaction(tx(vault, [transfer(ata(wallet, stock))]), wallet, "mainnet-beta", "claim")).not.toThrow();
    expect(() => checkTransaction(tx(vault, [transfer(ata(Keypair.generate().publicKey, stock))]), wallet, "mainnet-beta", "claim")).toThrow(/token instruction 12/);
  });
});

describe("checkCreate", () => {
  const me = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const feeTo = Keypair.generate().publicKey;
  const tip = Keypair.generate().publicKey;
  const create = (payer = me, creator = me, m = mint, disc = "25be7ede2c9aab11") =>
    new TransactionInstruction({
      programId: LAUNCHLAB,
      keys: [payer, creator, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey, m].map((pubkey, i) => ({
        pubkey,
        isSigner: i === 0 || i === 6,
        isWritable: i === 0 || i >= 5,
      })),
      data: Buffer.concat([Buffer.from(disc, "hex"), Buffer.alloc(40)]),
    });
  const build = (ixs: TransactionInstruction[], payer = me) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message());
  const fee = { to: feeTo.toBase58(), lamports: 20_000_000n };
  const ok = () => [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    create(),
    SystemProgram.transfer({ fromPubkey: me, toPubkey: feeTo, lamports: 20_000_000 }),
    SystemProgram.transfer({ fromPubkey: me, toPubkey: tip, lamports: 100_000 }),
  ];

  it("passes the creator's own create with uspad's fee and a tip", () => {
    expect(() => checkCreate(build(ok()), me, "mainnet-beta", fee)).not.toThrow();
    // An admin's create carries no fee.
    expect(() => checkCreate(build([create(), SystemProgram.transfer({ fromPubkey: me, toPubkey: tip, lamports: 100_000 })]), me, "mainnet-beta", fee)).not.toThrow();
  });

  it("refuses a create paid by, or made for, someone else", () => {
    const other = Keypair.generate().publicKey;
    expect(() => checkCreate(build([create(other, me)], other), me, "mainnet-beta", fee)).toThrow(UnsafeTransaction);
    expect(() => checkCreate(build([create(me, other)]), me, "mainnet-beta", fee)).toThrow(/someone else/);
  });

  it("refuses more SOL than the fee and a small tip, and anything that isn't a create", () => {
    const [cu, c, f, t] = ok();
    expect(() => checkCreate(build([cu!, c!, SystemProgram.transfer({ fromPubkey: me, toPubkey: feeTo, lamports: 30_000_000 }), t!]), me, "mainnet-beta", fee)).toThrow(/above uspad's/);
    expect(() => checkCreate(build([cu!, c!, f!, SystemProgram.transfer({ fromPubkey: me, toPubkey: tip, lamports: 50_000_000 })]), me, "mainnet-beta", fee)).toThrow(/isn't the launch fee or the tip/);
    expect(() => checkCreate(build([...ok(), SystemProgram.transfer({ fromPubkey: me, toPubkey: tip, lamports: 1 })]), me, "mainnet-beta", fee)).toThrow(/isn't the launch fee or the tip/);
    expect(() => checkCreate(build([cu!, create(me, me, mint, "faea0d7b9eb9d7d0"), f!, t!]), me, "mainnet-beta", fee)).toThrow(/isn't a coin create/);
    expect(() => checkCreate(build([cu!, f!, t!]), me, "mainnet-beta", fee)).toThrow(/a coin create|another signer/);
  });

  it("refuses a priority fee that would cost more than 0.001 SOL (audit)", () => {
    const [cu, c, f, t] = ok();
    // 400k units at 2,000 micro-lamports = 800 lamports: fine. At 5,000,000 micro-lamports = 2 SOL: refused.
    expect(() => checkCreate(build([cu!, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_000 }), c!, f!, t!]), me, "mainnet-beta", fee)).not.toThrow();
    expect(() => checkCreate(build([cu!, ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000_000_000 }), c!, f!, t!]), me, "mainnet-beta", fee)).toThrow(/priority fee/);
    // No limit instruction: priced at the 1.4M-unit maximum.
    expect(() => checkCreate(build([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }), c!, f!, t!]), me, "mainnet-beta", fee)).toThrow(/priority fee/);
  });
});

describe("checkCreate with a dev buy (owner decision 2026-10-28)", () => {
  const me = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const other = Keypair.generate().publicKey;
  const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const ata22 = (owner: PublicKey, m: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_2022.toBuffer(), m.toBuffer()], ATA)[0];
  const meta = (pubkey: PublicKey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  // The create's accounts the buy shares: 2 config, 3 platform, 4 auth, 5 pool, 8 and 9 the vaults.
  const [config, platform, auth, pool, vaultA, vaultB] = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
  const create = new TransactionInstruction({
    programId: LAUNCHLAB,
    keys: [me, me, config!, platform!, auth!, pool!, mint, WSOL, vaultA!, vaultB!].map((k, i) => meta(k, i === 0 || i === 6, i === 0 || i >= 5)),
    data: Buffer.concat([Buffer.from("25be7ede2c9aab11", "hex"), Buffer.alloc(40)]),
  });
  const ataIx = (m: PublicKey, prog: PublicKey, owner = me) =>
    new TransactionInstruction({
      programId: ATA,
      keys: [meta(me, true, true), meta(prog.equals(TOKEN) ? ata(owner, m) : ata22(owner, m), false, true), meta(owner), meta(m), meta(SystemProgram.programId), meta(prog)],
      data: Buffer.from([1]),
    });
  const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
  };
  // buy_exact_in: 0 buyer, 5 their coin account, 6 their WSOL account, 9 the mint (raydium-sdk-v2 buyExactInInstruction).
  const buy = (lamports: bigint, o: { coinAccount?: PublicKey; m?: PublicKey; pool?: PublicKey; shareFee?: bigint; receiver?: PublicKey } = {}) => {
    const k = Array.from({ length: 18 }, () => Keypair.generate().publicKey);
    [k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7], k[8], k[9]] = [me, auth!, config!, platform!, o.pool ?? pool!, o.coinAccount ?? ata22(me, mint), ata(me, WSOL), vaultA!, vaultB!, o.m ?? mint];
    if (o.receiver) k.splice(15, 0, o.receiver);
    return new TransactionInstruction({
      programId: LAUNCHLAB,
      keys: k.map((x, i) => meta(x, i === 0, i === 0 || i === 5 || i === 6)),
      data: Buffer.concat([Buffer.from([250, 234, 13, 123, 213, 156, 19, 236]), u64(lamports), u64(1n), u64(o.shareFee ?? 0n)]),
    });
  };
  const wrapIx = (lamports: number) => SystemProgram.transfer({ fromPubkey: me, toPubkey: ata(me, WSOL), lamports });
  const sync = new TransactionInstruction({ programId: TOKEN, keys: [meta(ata(me, WSOL), false, true)], data: Buffer.from([17]) });
  const close = (to = me) => new TransactionInstruction({ programId: TOKEN, keys: [meta(ata(me, WSOL), false, true), meta(to, false, true), meta(me, true)], data: Buffer.from([9]) });
  const devBuy = (o: { wrap?: number; buy?: TransactionInstruction; close?: TransactionInstruction } = {}) => [
    ataIx(mint, TOKEN_2022),
    ataIx(WSOL, TOKEN),
    wrapIx(o.wrap ?? 1_000_000_000),
    sync,
    o.buy ?? buy(1_000_000_000n),
    o.close ?? close(),
  ];
  const build = (ixs: TransactionInstruction[]) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: me, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message());
  const tip = SystemProgram.transfer({ fromPubkey: me, toPubkey: Keypair.generate().publicKey, lamports: 100_000 });
  const fee = { to: null, lamports: 0n };
  const check = (ixs: TransactionInstruction[], typed: bigint) => () => checkCreate(build([create, ...ixs, tip]), me, "mainnet-beta", fee, typed);

  it("passes the dev buy the creator typed, into their own accounts", () => {
    expect(check(devBuy(), 1_000_000_000n)).not.toThrow();
  });

  it("refuses a dev buy nobody asked for, or of another amount", () => {
    expect(check(devBuy(), 0n)).toThrow(UnsafeTransaction);
    expect(check(devBuy({ buy: buy(2_000_000_000n) }), 1_000_000_000n)).toThrow(/amount you typed/);
    expect(check(devBuy({ wrap: 2_000_000_000 }), 1_000_000_000n)).toThrow(/amount you typed/);
    expect(check([], 1_000_000_000n)).toThrow(/missing/);
  });

  it("refuses a dev buy into someone else's account, of another coin, or that hands the WSOL to someone else", () => {
    expect(check(devBuy({ buy: buy(1_000_000_000n, { coinAccount: ata22(other, mint) }) }), 1_000_000_000n)).toThrow(/someone else/);
    expect(check(devBuy({ buy: buy(1_000_000_000n, { m: Keypair.generate().publicKey }) }), 1_000_000_000n)).toThrow(/another coin/);
    expect(check(devBuy({ close: close(other) }), 1_000_000_000n)).toThrow(/isn't part of a dev buy/);
    expect(check([ataIx(mint, TOKEN_2022, other), ...devBuy()], 1_000_000_000n)).toThrow(/token account for someone else/);
  });

  it("refuses a dev buy that pays a share fee, trades another pool, or comes before the create (audit)", () => {
    expect(check(devBuy({ buy: buy(1_000_000_000n, { shareFee: 10_000n, receiver: other }) }), 1_000_000_000n)).toThrow(/share of it to someone else/);
    expect(check(devBuy({ buy: buy(1_000_000_000n, { shareFee: 10_000n }) }), 1_000_000_000n)).toThrow(/share of it to someone else/);
    expect(check(devBuy({ buy: buy(1_000_000_000n, { pool: Keypair.generate().publicKey }) }), 1_000_000_000n)).toThrow(/outside the new coin's pool/);
    expect(() => checkCreate(build([...devBuy(), create, tip]), me, "mainnet-beta", fee, 1_000_000_000n)).toThrow(/before the coin's create/);
  });
});

describe("in the browser", () => {
  // The browser's Buffer is Next.js's polyfill, without readBigUInt64LE: the checks must not need it
  // (2026-10-28: every creator-signed create failed here before the wallet saw it).
  const NextBuffer = (createRequire(import.meta.url)("next/dist/compiled/buffer") as { Buffer: typeof Buffer }).Buffer;
  afterEach(() => vi.unstubAllGlobals());

  it("checks a create and a trade with Next.js's Buffer polyfill", () => {
    expect(typeof NextBuffer.prototype.readBigUInt64LE).toBe("undefined");
    const me = Keypair.generate().publicKey;
    const create = new TransactionInstruction({
      programId: LAUNCHLAB,
      keys: [me, me, ...Array.from({ length: 5 }, () => Keypair.generate().publicKey)].map((pubkey, i) => ({ pubkey, isSigner: i === 0 || i === 6, isWritable: i === 0 || i >= 5 })),
      data: Buffer.concat([Buffer.from("25be7ede2c9aab11", "hex"), Buffer.alloc(40)]),
    });
    const feeTo = Keypair.generate().publicKey;
    const built = new VersionedTransaction(
      new TransactionMessage({
        payerKey: me,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          create,
          SystemProgram.transfer({ fromPubkey: me, toPubkey: feeTo, lamports: 20_000_000 }),
          SystemProgram.transfer({ fromPubkey: me, toPubkey: Keypair.generate().publicKey, lamports: 100_000 }),
        ],
      }).compileToV0Message(),
    );
    const trade = tx(wallet, [wrap(1000)]);
    // The page gets the create as base64 and deserializes it, as LaunchModal does.
    const b64 = Buffer.from(built.serialize()).toString("base64");
    vi.stubGlobal("Buffer", NextBuffer);
    const got = VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    expect(() => checkCreate(got, me, "mainnet-beta", { to: feeTo.toBase58(), lamports: 20_000_000n })).not.toThrow();
    expect(() => checkCreate(got, me, "mainnet-beta", { to: feeTo.toBase58(), lamports: 10_000_000n })).toThrow(/above uspad's/);
    expect(() => checkTransaction(trade, wallet, "mainnet-beta", "trade")).not.toThrow();
  });
});
