/**
 * The browser checks every transaction the API hands it before the wallet sees it (audit: a
 * compromised API could otherwise slip a transfer or an approval into a trade or a claim). Only the
 * programs and instructions a Divvy trade or claim needs are allowed, and nothing may move the
 * user's funds anywhere but their own accounts.
 */
import { BRAND } from "./brand";
import { txErrors } from "../i18n/msgs/errors";
import { ComputeBudgetProgram, PublicKey, SystemProgram, type VersionedTransaction } from "@solana/web3.js";

// Program IDs (docs/VERIFIED.md item 1; Raydium SDK ALL_PROGRAM_ID / DEVNET_PROGRAM_ID; spl-token constants).
const LAUNCHLAB = { "mainnet-beta": "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", devnet: "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6" } as const;
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const WSOL = "So11111111111111111111111111111111111111112";

export type TxKind = "trade" | "claim" | "creator-claim";

/** The most a trade or claim may spend on its priority fee. */
const MAX_TRADE_PRIORITY_LAMPORTS = 5_000_000n;

export class UnsafeTransaction extends Error {
  override name = "UnsafeTransaction";
  constructor(readonly reason: string) {
    super(txErrors.en.unsafe(reason));
  }
}

/**
 * Little-endian reads straight from the instruction bytes. Not Buffer's: in the browser Buffer is Next.js's
 * polyfill, which has no readBigUInt64LE, so every creator-signed create failed this check before the
 * wallet ever saw it (2026-10-28, the first mainnet tries). A read past the end is null.
 */
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u32 = (b: Uint8Array, o: number): number | null => (b.length >= o + 4 ? view(b).getUint32(o, true) : null);
const u64 = (b: Uint8Array, o: number): bigint | null => (b.length >= o + 8 ? view(b).getBigUint64(o, true) : null);
const startsWith = (b: Uint8Array, prefix: Uint8Array) => b.length >= prefix.length && prefix.every((x, i) => b[i] === x);

const ataOf = (owner: PublicKey, program: string, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(program).toBuffer(), mint.toBuffer()], new PublicKey(ATA))[0];
const wsolAta = (owner: PublicKey) => ataOf(owner, TOKEN, new PublicKey(WSOL));

export function checkTransaction(tx: VersionedTransaction, wallet: PublicKey, network: "mainnet-beta" | "devnet", kind: TxKind, coinMint?: PublicKey): void {
  const msg = tx.message;
  // Static keys only: a program can't be loaded from an address lookup table, and only Jupiter routes
  // use them. An index past the static keys is a lookup-table account, which reads as null below.
  const keys = { get: (i: number): PublicKey | undefined => msg.staticAccountKeys[i] };
  const payer = msg.staticAccountKeys[0]!;
  const signers = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures);
  if (!signers.some((s) => s.equals(wallet))) throw new UnsafeTransaction("this transaction isn't for your wallet");
  if (kind !== "claim" && !payer.equals(wallet)) throw new UnsafeTransaction("another account would pay for this transaction");
  // Only a claim has a co-signer (the payout vault, which pays the fee and sends the tokens).
  if (kind !== "claim" && signers.length !== 1) throw new UnsafeTransaction("this transaction needs another signer");

  const allowed = new Set([ComputeBudgetProgram.programId.toBase58(), SystemProgram.programId.toBase58(), TOKEN, TOKEN_2022, ATA, LAUNCHLAB[network]]);
  if (kind === "trade" && msg.addressTableLookups.length) allowed.add(JUPITER);
  const myWsol = wsolAta(wallet);
  const at = (ix: { accountKeyIndexes: number[] }, i: number) => {
    const k = ix.accountKeyIndexes[i];
    return k === undefined ? null : (keys.get(k) ?? null); // null: a lookup-table account
  };

  // The priority fee (compute unit price × limit; 1.4M units without a limit) is capped, so a bad server
  // can't spend the wallet's SOL on it (audit). The site's own trades pay at most about 0.001 SOL.
  let cuPrice = 0n;
  let cuLimit = 1_400_000n;
  for (const ix of msg.compiledInstructions) {
    if (keys.get(ix.programIdIndex)?.toBase58() !== ComputeBudgetProgram.programId.toBase58()) continue;
    if (ix.data[0] === 2 && ix.data.length >= 5) cuLimit = BigInt(u32(ix.data, 1)!);
    else if (ix.data[0] === 3 && ix.data.length >= 9) cuPrice = u64(ix.data, 1)!;
  }
  if ((cuPrice * cuLimit) / 1_000_000n > MAX_TRADE_PRIORITY_LAMPORTS) throw new UnsafeTransaction("a priority fee above 0.005 SOL");

  // A trade must be about the coin you picked (a route via lookup tables may hold it there instead).
  if (coinMint && !msg.addressTableLookups.length && !msg.staticAccountKeys.some((k) => k.equals(coinMint))) throw new UnsafeTransaction("this trade is for a different coin");

  for (const ix of msg.compiledInstructions) {
    const prog = keys.get(ix.programIdIndex)?.toBase58() ?? "";
    if (!allowed.has(prog)) throw new UnsafeTransaction(`unexpected program ${prog}`);
    const data = ix.data;
    if (prog === SystemProgram.programId.toBase58()) {
      // Only wrapping SOL into your own WSOL account (tag 2 = Transfer).
      if (u32(data, 0) !== 2 || !at(ix, 1)?.equals(myWsol)) throw new UnsafeTransaction("a SOL transfer to someone else");
    } else if (prog === TOKEN || prog === TOKEN_2022) {
      const tag = data[0];
      if (tag === 17) continue; // SyncNative
      if (tag === 9 && at(ix, 1)?.equals(wallet)) continue; // CloseAccount back to you
      // TransferChecked into your account, signed by someone else (the payout vault paying you).
      if (kind === "claim" && tag === 12 && !at(ix, 3)?.equals(wallet)) {
        const mint = at(ix, 1);
        const dest = at(ix, 2);
        const mine = mint && PublicKey.findProgramAddressSync([wallet.toBuffer(), new PublicKey(prog).toBuffer(), mint.toBuffer()], new PublicKey(ATA))[0];
        if (mine && dest?.equals(mine)) continue;
      }
      throw new UnsafeTransaction(`token instruction ${tag} isn't part of a ${kind}`);
    } else if (prog === ATA) {
      if (!at(ix, 2)?.equals(wallet)) throw new UnsafeTransaction("a token account for someone else");
    }
  }
}

/** initialize_with_token_2022's discriminator, the create's own (Anchor sighash; packages/solana createInstruction). */
const INITIALIZE_WITH_TOKEN_2022 = Uint8Array.from([0x25, 0xbe, 0x7e, 0xde, 0x2c, 0x9a, 0xab, 0x11]);
/** buy_exact_in's discriminator (raydium-sdk-v2 launchpad/instrument.ts anchorDataBuf.buyExactIn), the dev buy's. */
const BUY_EXACT_IN = Uint8Array.from([250, 234, 13, 123, 213, 156, 19, 236]);
/** The Jito tip is a small transfer; anything bigger to an address the page can't check is refused. */
const MAX_TIP_LAMPORTS = 1_000_000n;
/** The most the create's priority fee (compute unit price × limit) may cost the creator (audit). */
const MAX_PRIORITY_LAMPORTS = 1_000_000n;

/**
 * The coin's create, which the creator's wallet signs and pays for (owner decision 2026-10-27). It may
 * spend the creator's SOL on the new coin's accounts (inside LaunchLab's create), the launch fee to
 * the platform's fee wallet, and one small Jito tip; nothing else. The payer and the coin's creator must both
 * be this wallet, the only other signer is the new mint, and no account comes from a lookup table.
 *
 * With `devBuyLamports` (owner decision 2026-10-28) it also holds the dev buy the creator typed, and
 * only that: exactly that much SOL wrapped into their own WSOL account, one buy of this coin for that
 * amount into their own token account, after the create and in its pool, with no share fee to anyone,
 * and the WSOL account closed back to them.
 */
export function checkCreate(tx: VersionedTransaction, wallet: PublicKey, network: "mainnet-beta" | "devnet", fee: { to: string | null; lamports: bigint }, devBuyLamports = 0n): void {
  const msg = tx.message;
  const keys = msg.staticAccountKeys;
  if (msg.addressTableLookups.length) throw new UnsafeTransaction("this launch loads accounts from elsewhere");
  if (!keys[0]?.equals(wallet)) throw new UnsafeTransaction("another account would pay for this launch");
  if (msg.header.numRequiredSignatures !== 2) throw new UnsafeTransaction("this launch needs another signer");
  const mint = keys[1]!;
  const at = (ix: { accountKeyIndexes: number[] }, i: number) => {
    const k = ix.accountKeyIndexes[i];
    return k === undefined ? null : (keys[k] ?? null);
  };
  let creates = 0;
  let fees = 0;
  let tips = 0;
  let buys = 0;
  let wraps = 0;
  // The create's own accounts: 2 global config, 3 platform config, 4 auth, 5 pool, 8 and 9 its vaults.
  let created: { accountKeyIndexes: number[] } | null = null;
  const myWsol = wsolAta(wallet);
  const myCoin = ataOf(wallet, TOKEN_2022, mint);
  // Without a limit instruction a transaction may use up to 1.4M compute units.
  let cuPrice = 0n;
  let cuLimit = 1_400_000n;
  for (const ix of msg.compiledInstructions) {
    const prog = keys[ix.programIdIndex]?.toBase58() ?? "";
    const data = ix.data;
    if (prog === ComputeBudgetProgram.programId.toBase58()) {
      // SetComputeUnitLimit (2, u32) and SetComputeUnitPrice (3, u64 micro-lamports).
      if (data[0] === 2 && data.length >= 5) cuLimit = BigInt(u32(data, 1)!);
      else if (data[0] === 3 && data.length >= 9) cuPrice = u64(data, 1)!;
      continue;
    }
    if (prog === LAUNCHLAB[network] && devBuyLamports > 0n && startsWith(data, BUY_EXACT_IN)) {
      // buy_exact_in (docs/VERIFIED.md item 29): amount_b, min_amount_a, share_fee_rate; 18 accounts
      // without a share-fee receiver. 0 buyer, 1 auth, 2 config, 3 platform, 4 pool, 5 their coin
      // account, 6 their WSOL account, 7 and 8 the vaults, 9 the coin's mint.
      if (!created) throw new UnsafeTransaction("a dev buy before the coin's create");
      const c = created;
      const same = (i: number, j: number) => at(ix, i)?.equals(at(c, j)!) === true;
      if (buys++ || !at(ix, 0)?.equals(wallet) || !at(ix, 5)?.equals(myCoin) || !at(ix, 6)?.equals(myWsol) || !at(ix, 9)?.equals(mint)) throw new UnsafeTransaction("a dev buy for someone else or another coin");
      if (!same(1, 4) || !same(2, 2) || !same(3, 3) || !same(4, 5) || !same(7, 8) || !same(8, 9)) throw new UnsafeTransaction("a dev buy outside the new coin's pool");
      if (data.length !== 32 || ix.accountKeyIndexes.length !== 18 || u64(data, 24) !== 0n) throw new UnsafeTransaction("a dev buy that pays a share of it to someone else");
      if (u64(data, 8) !== devBuyLamports) throw new UnsafeTransaction("a dev buy that isn't the amount you typed");
      continue;
    }
    if (prog === LAUNCHLAB[network]) {
      // Accounts: 0 payer, 1 creator, 6 the new mint (packages/solana createInstruction).
      if (!startsWith(data, INITIALIZE_WITH_TOKEN_2022)) throw new UnsafeTransaction("a LaunchLab instruction that isn't a coin create");
      if (!at(ix, 0)?.equals(wallet) || !at(ix, 1)?.equals(wallet)) throw new UnsafeTransaction("a coin create for someone else");
      if (!at(ix, 6)?.equals(mint)) throw new UnsafeTransaction("a coin create for another mint");
      creates++;
      created = ix;
      continue;
    }
    if (prog === SystemProgram.programId.toBase58()) {
      if (data.length !== 12 || u32(data, 0) !== 2 || !at(ix, 0)?.equals(wallet)) throw new UnsafeTransaction("a SOL transfer that isn't the launch fee or the tip");
      const to = at(ix, 1)?.toBase58();
      const lamports = u64(data, 4)!;
      if (devBuyLamports > 0n && to === myWsol.toBase58() && wraps === 0) {
        if (lamports !== devBuyLamports) throw new UnsafeTransaction("a dev buy that isn't the amount you typed");
        wraps++;
      } else if (fee.to && to === fee.to && fees === 0) {
        if (lamports > fee.lamports) throw new UnsafeTransaction(`a launch fee above ${BRAND}'s`);
        fees++;
      } else if (tips === 0 && lamports <= MAX_TIP_LAMPORTS) tips++;
      else throw new UnsafeTransaction("a SOL transfer that isn't the launch fee or the tip");
      continue;
    }
    if (devBuyLamports > 0n && prog === ATA) {
      // Create-idempotent of the creator's own account for this coin or for WSOL: 0 payer, 2 owner, 3 mint.
      const m = at(ix, 3);
      if (data[0] !== 1 || !at(ix, 0)?.equals(wallet) || !at(ix, 2)?.equals(wallet) || !(m?.equals(mint) || m?.toBase58() === WSOL)) throw new UnsafeTransaction("a token account for someone else");
      continue;
    }
    if (devBuyLamports > 0n && prog === TOKEN) {
      // SyncNative on the creator's WSOL account, and closing it back to them after the buy.
      if (data[0] === 17 && at(ix, 0)?.equals(myWsol)) continue;
      if (data[0] === 9 && at(ix, 0)?.equals(myWsol) && at(ix, 1)?.equals(wallet)) continue;
      throw new UnsafeTransaction(`token instruction ${data[0]} isn't part of a dev buy`);
    }
    throw new UnsafeTransaction(`unexpected program ${prog}`);
  }
  if (creates !== 1) throw new UnsafeTransaction("this isn't a coin create");
  if (devBuyLamports > 0n && (buys !== 1 || wraps !== 1)) throw new UnsafeTransaction("the dev buy you asked for is missing");
  if ((cuPrice * cuLimit) / 1_000_000n > MAX_PRIORITY_LAMPORTS) throw new UnsafeTransaction("a priority fee above 0.001 SOL");
}
