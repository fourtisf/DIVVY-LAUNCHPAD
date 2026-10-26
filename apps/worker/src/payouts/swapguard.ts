/**
 * The fee claimer signs swap instructions that come from Jupiter's API. Before it does, every
 * instruction is checked against what a SOL → asset swap needs (audit: a compromised API or proxy
 * could otherwise add a transfer that drains the wallet). A simulation of the final transaction then
 * bounds what it actually spends and receives (chain.ts).
 */
import { ComputeBudgetProgram, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { JUPITER_PROGRAM_ID } from "@divvy/solana/live";

export class SwapRejected extends Error {}

/** SPL Token instruction tags (token-2022 interface/src/instruction.rs): CloseAccount = 9, SyncNative = 17. */
const TOKEN_CLOSE_ACCOUNT = 9;
const TOKEN_SYNC_NATIVE = 17;
/** System program Transfer is tag 2 (u32 LE). */
const SYSTEM_TRANSFER = 2;

export function checkSwapInstructions(
  ixs: TransactionInstruction[],
  p: { payer: PublicKey; payerWsolAta: PublicKey; ataOwners: PublicKey[] },
): void {
  for (const ix of ixs) {
    const prog = ix.programId;
    for (const k of ix.keys) if (k.isSigner && !k.pubkey.equals(p.payer)) throw new SwapRejected(`an instruction needs another signer (${k.pubkey.toBase58()})`);
    if (prog.equals(ComputeBudgetProgram.programId) || prog.equals(JUPITER_PROGRAM_ID)) continue;
    if (prog.equals(SystemProgram.programId)) {
      // Only wrapping SOL into the payer's own WSOL account.
      if (ix.data.length >= 4 && ix.data.readUInt32LE(0) === SYSTEM_TRANSFER && ix.keys[1]?.pubkey.equals(p.payerWsolAta)) continue;
      throw new SwapRejected("a System instruction other than wrapping SOL");
    }
    if (prog.equals(TOKEN_PROGRAM_ID) || prog.equals(TOKEN_2022_PROGRAM_ID)) {
      const tag = ix.data[0];
      if (tag === TOKEN_SYNC_NATIVE) continue;
      // CloseAccount(account, destination, owner): only returning rent to the payer.
      if (tag === TOKEN_CLOSE_ACCOUNT && ix.keys[1]?.pubkey.equals(p.payer) && ix.keys[2]?.pubkey.equals(p.payer)) continue;
      throw new SwapRejected(`token instruction ${tag} isn't part of a swap`);
    }
    if (prog.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // Create / CreateIdempotent(payer, ata, owner, mint, ...): accounts for the payer or the payout vault.
      const owner = ix.keys[2]?.pubkey;
      if ((ix.data.length === 0 || ix.data[0] === 0 || ix.data[0] === 1) && ix.keys[0]?.pubkey.equals(p.payer) && owner && p.ataOwners.some((o) => o.equals(owner))) continue;
      throw new SwapRejected("an associated token account for someone else");
    }
    throw new SwapRejected(`unexpected program ${prog.toBase58()}`);
  }
}
