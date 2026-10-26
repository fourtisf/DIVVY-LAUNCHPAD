import { describe, expect, it } from "vitest";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { createApproveInstruction, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createSyncNativeInstruction, createTransferInstruction, NATIVE_MINT } from "@solana/spl-token";
import { JUPITER_PROGRAM_ID } from "@divvy/solana/live";
import { checkSwapInstructions, SwapRejected } from "../src/payouts/swapguard";

const payer = Keypair.generate().publicKey;
const vault = Keypair.generate().publicKey;
const wsolAta = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const p = { payer, payerWsolAta: wsolAta, ataOwners: [payer, vault] };
const jup = new TransactionInstruction({ programId: JUPITER_PROGRAM_ID, keys: [{ pubkey: payer, isSigner: true, isWritable: true }], data: Buffer.alloc(8) });

describe("swap instruction guard (audit: the fee claimer signs what Jupiter returns)", () => {
  it("accepts what a SOL → asset swap needs", () => {
    expect(() =>
      checkSwapInstructions(
        [
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
          createAssociatedTokenAccountIdempotentInstruction(payer, wsolAta, payer, NATIVE_MINT),
          SystemProgram.transfer({ fromPubkey: payer, toPubkey: wsolAta, lamports: 5 }),
          createSyncNativeInstruction(wsolAta),
          createAssociatedTokenAccountIdempotentInstruction(payer, Keypair.generate().publicKey, vault, mint),
          jup,
          createCloseAccountInstruction(wsolAta, payer, payer),
        ],
        p,
      ),
    ).not.toThrow();
  });
  it("refuses a SOL transfer anywhere else", () => {
    expect(() => checkSwapInstructions([SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 5 })], p)).toThrow(SwapRejected);
  });
  it("refuses token transfers, approvals and closing to someone else", () => {
    const other = Keypair.generate().publicKey;
    expect(() => checkSwapInstructions([createTransferInstruction(wsolAta, other, payer, 5)], p)).toThrow(SwapRejected);
    expect(() => checkSwapInstructions([createApproveInstruction(wsolAta, other, payer, 5)], p)).toThrow(SwapRejected);
    expect(() => checkSwapInstructions([createCloseAccountInstruction(wsolAta, other, payer)], p)).toThrow(SwapRejected);
  });
  it("refuses unknown programs, other signers and accounts created for strangers", () => {
    expect(() => checkSwapInstructions([new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(1) })], p)).toThrow(SwapRejected);
    const stranger = Keypair.generate().publicKey;
    expect(() => checkSwapInstructions([new TransactionInstruction({ programId: JUPITER_PROGRAM_ID, keys: [{ pubkey: stranger, isSigner: true, isWritable: true }], data: Buffer.alloc(8) })], p)).toThrow(SwapRejected);
    expect(() => checkSwapInstructions([createAssociatedTokenAccountIdempotentInstruction(payer, Keypair.generate().publicKey, stranger, mint)], p)).toThrow(SwapRejected);
    expect(new PublicKey(JUPITER_PROGRAM_ID).toBase58()).toBe("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
  });
});
