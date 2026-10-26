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
    super(`Divvy stopped this transaction before your wallet saw it: ${reason}.`);
  }
}

const wsolAta = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), new PublicKey(TOKEN).toBuffer(), new PublicKey(WSOL).toBuffer()], new PublicKey(ATA))[0];

export function checkTransaction(tx: VersionedTransaction, wallet: PublicKey, network: "mainnet-beta" | "devnet", kind: TxKind, coinMint?: PublicKey): void {
  const msg = tx.message;
  // Address lookup tables can't hold program ids, and only Jupiter routes use them.
  const keys = msg.getAccountKeys({ accountKeysFromLookups: msg.addressTableLookups.length ? { writable: [], readonly: [] } : undefined });
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
