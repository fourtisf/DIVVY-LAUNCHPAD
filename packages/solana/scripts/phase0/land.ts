/**
 * land.ts — sends a platform-admin transaction so it lands on a busy mainnet.
 *
 * A transaction without a priority fee can sit unseen until its blockhash expires (the first
 * PlatformConfig send on 2026-10-27 did: "block height exceeded"). So: a priority fee, the same
 * signed transaction re-sent every 2 seconds until it confirms, and a fresh blockhash when one expires,
 * at most ATTEMPTS times. Before each attempt `done()` reads the chain, so an attempt that landed after
 * all is never applied twice.
 *
 *   CU_PRICE_MICROLAMPORTS [1000000 = 1 lamport per compute unit]
 */
import { Connection, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export const CU_PRICE_MICROLAMPORTS = Number(process.env.CU_PRICE_MICROLAMPORTS ?? "1000000");
const ATTEMPTS = 3;
const RESEND_MS = 2_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Priority fee in lamports for a compute-unit limit, to print before sending. */
export const priorityLamports = (cuLimit: number): number => Math.ceil((cuLimit * CU_PRICE_MICROLAMPORTS) / 1_000_000);

/**
 * Signs with `sign(blockhash)` and sends until confirmed. Returns the signature, or null when `done()`
 * says the change is already on chain.
 */
export async function sendUntilLanded(
  conn: Connection,
  sign: (blockhash: string) => VersionedTransaction,
  done: () => Promise<boolean>,
  purpose: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (await done()) {
      console.log(`${purpose}: already on chain, nothing sent`);
      return null;
    }
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = sign(blockhash);
    const raw = tx.serialize();
    const sig = bs58.encode(tx.signatures[0]!);
    console.log(`${purpose}: sending ${sig} (attempt ${attempt}/${ATTEMPTS}, signer: platform admin)`);
    for (;;) {
      await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch((e: unknown) => console.log(`  resend failed: ${e instanceof Error ? e.message : String(e)}`));
      await sleep(RESEND_MS);
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st?.err) throw new Error(`${purpose} failed on chain: ${JSON.stringify(st.err)} (${sig})`);
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
        console.log(`SENT ${sig} — purpose: ${purpose}, signer: platform admin`);
        return sig;
      }
      if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) break;
    }
    // Included in the last moments before expiry: its status shows up a little later.
    await sleep(RESEND_MS);
    const late = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
    if (late?.err) throw new Error(`${purpose} failed on chain: ${JSON.stringify(late.err)} (${sig})`);
    if (late) {
      console.log(`SENT ${sig} — purpose: ${purpose}, signer: platform admin`);
      return sig;
    }
    console.log(`  ${sig} expired without landing (nothing was charged)`);
  }
  throw new Error(`${purpose} didn't land after ${ATTEMPTS} attempts. Run it again, or with a higher CU_PRICE_MICROLAMPORTS (now ${CU_PRICE_MICROLAMPORTS}).`);
}
