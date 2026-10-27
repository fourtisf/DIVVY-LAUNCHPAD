import { describe, expect, it } from "vitest";
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
