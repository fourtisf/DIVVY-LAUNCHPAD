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
import { checkTransaction } from "./txcheck";

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
