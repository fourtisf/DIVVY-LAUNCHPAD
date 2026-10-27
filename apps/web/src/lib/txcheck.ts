/**
 * The browser checks every transaction the API hands it before the wallet sees it (audit: a
 * compromised API could otherwise slip a transfer or an approval into a trade or a claim). Only the
 * programs and instructions a Divvy trade or claim needs are allowed, and nothing may move the
 * user's funds anywhere but their own accounts.
 */
import { ComputeBudgetProgram, PublicKey, SystemProgram, type VersionedTransaction } from "@solana/web3.js";

// Program IDs (docs/VERIFIED.md item 1; Raydium SDK ALL_PROGRAM_ID / DEVNET_PROGRAM_ID; spl-token constants).
const LAUNCHLAB = { "mainnet-beta": "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj", devnet: "DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6" } as const;
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const WSOL = "So11111111111111111111111111111111111111112";

export type TxKind = "trade" | "claim" | "creator-claim";

export class UnsafeTransaction extends Error {
  override name = "UnsafeTransaction";
  constructor(reason: string) {
    super(`uspad stopped this transaction before your wallet saw it: ${reason}.`);
  }
}

const wsolAta = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(WSOL).toBuffer()], new PublicKey(ATA))[0];

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

  // A trade must be about the coin you picked (a route via lookup tables may hold it there instead).
  if (coinMint && !msg.addressTableLookups.length && !msg.staticAccountKeys.some((k) => k.equals(coinMint))) throw new UnsafeTransaction("this trade is for a different coin");

  for (const ix of msg.compiledInstructions) {
    const prog = keys.get(ix.programIdIndex)?.toBase58() ?? "";
    if (!allowed.has(prog)) throw new UnsafeTransaction(`unexpected program ${prog}`);
    const data = Buffer.from(ix.data);
    if (prog === SystemProgram.programId.toBase58()) {
      // Only wrapping SOL into your own WSOL account (tag 2 = Transfer).
      if (data.readUInt32LE(0) !== 2 || !at(ix, 1)?.equals(myWsol)) throw new UnsafeTransaction("a SOL transfer to someone else");
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
const INITIALIZE_WITH_TOKEN_2022 = Buffer.from("25be7ede2c9aab11", "hex");
/** The Jito tip is a small transfer; anything bigger to an address the page can't check is refused. */
const MAX_TIP_LAMPORTS = 1_000_000n;
/** The most the create's priority fee (compute unit price × limit) may cost the creator (audit). */
const MAX_PRIORITY_LAMPORTS = 1_000_000n;

/**
 * The coin's create, which the creator's wallet signs and pays for (owner decision 2026-10-27). It may
 * spend the creator's SOL on the new coin's accounts (inside LaunchLab's create), uspad's launch fee to
 * uspad's fee wallet, and one small Jito tip; nothing else. The payer and the coin's creator must both
 * be this wallet, the only other signer is the new mint, and no account comes from a lookup table.
 */
export function checkCreate(tx: VersionedTransaction, wallet: PublicKey, network: "mainnet-beta" | "devnet", fee: { to: string | null; lamports: bigint }): void {
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
  // Without a limit instruction a transaction may use up to 1.4M compute units.
  let cuPrice = 0n;
  let cuLimit = 1_400_000n;
  for (const ix of msg.compiledInstructions) {
    const prog = keys[ix.programIdIndex]?.toBase58() ?? "";
    const data = Buffer.from(ix.data);
    if (prog === ComputeBudgetProgram.programId.toBase58()) {
      // SetComputeUnitLimit (2, u32) and SetComputeUnitPrice (3, u64 micro-lamports).
      if (data[0] === 2 && data.length >= 5) cuLimit = BigInt(data.readUInt32LE(1));
      else if (data[0] === 3 && data.length >= 9) cuPrice = data.readBigUInt64LE(1);
      continue;
    }
    if (prog === LAUNCHLAB[network]) {
      // Accounts: 0 payer, 1 creator, 6 the new mint (packages/solana createInstruction).
      if (!data.subarray(0, 8).equals(INITIALIZE_WITH_TOKEN_2022)) throw new UnsafeTransaction("a LaunchLab instruction that isn't a coin create");
      if (!at(ix, 0)?.equals(wallet) || !at(ix, 1)?.equals(wallet)) throw new UnsafeTransaction("a coin create for someone else");
      if (!at(ix, 6)?.equals(mint)) throw new UnsafeTransaction("a coin create for another mint");
      creates++;
      continue;
    }
    if (prog === SystemProgram.programId.toBase58()) {
      if (data.length !== 12 || data.readUInt32LE(0) !== 2 || !at(ix, 0)?.equals(wallet)) throw new UnsafeTransaction("a SOL transfer that isn't the launch fee or the tip");
      const to = at(ix, 1)?.toBase58();
      const lamports = data.readBigUInt64LE(4);
      if (fee.to && to === fee.to && fees === 0) {
        if (lamports > fee.lamports) throw new UnsafeTransaction("a launch fee above uspad's");
        fees++;
      } else if (tips === 0 && lamports <= MAX_TIP_LAMPORTS) tips++;
      else throw new UnsafeTransaction("a SOL transfer that isn't the launch fee or the tip");
      continue;
    }
    throw new UnsafeTransaction(`unexpected program ${prog}`);
  }
  if (creates !== 1) throw new UnsafeTransaction("this isn't a coin create");
  if ((cuPrice * cuLimit) / 1_000_000n > MAX_PRIORITY_LAMPORTS) throw new UnsafeTransaction("a priority fee above 0.001 SOL");
}
