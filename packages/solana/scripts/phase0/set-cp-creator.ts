/**
 * set-cp-creator.ts — sets PlatformConfig.platform_cp_creator, the wallet that receives the CPMM
 * creator fee of every graduated coin, and SIMULATES it.
 *
 * DEFAULT IS DRY RUN. It only sends when BOTH `--send` is passed AND env I_HAVE_OWNER_APPROVAL=yes.
 * The owner decided on 2026-10-26 that the creator fee goes to uspad's fee claimer and is split
 * 50 : 15 : 10 (docs/AUDIT.md "Open owner decisions"). The worker collects it with CPMM_CREATOR_FEES.
 *
 * Usage (dry run with just pubkeys):
 *   RPC_URL=... PLATFORM_ADMIN_PUBKEY=<admin> CP_CREATOR=<fee claimer pubkey> npx tsx set-cp-creator.ts
 * Usage (send, after the PlatformConfig exists; updates are rate-limited per epoch, so this may have
 * to wait for the epoch after creation):
 *   RPC_URL=... PLATFORM_ADMIN_KEYPAIR=/path/admin.json CP_CREATOR=<pubkey> I_HAVE_OWNER_APPROVAL=yes npx tsx set-cp-creator.ts --send
 *
 * SDK API used (raydium-sdk-V2@b69d02b, npm 0.2.75-alpha):
 *   updatePlatformConfig({ type: "updatePlatformCpCreator" })  src/raydium/launchpad/instrument.ts:837-976
 *   getPdaPlatformId()                                           src/raydium/launchpad/pda.ts:54
 *   PlatformConfig.platformCpCreator                             src/raydium/launchpad/layout.ts:125
 */
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LAUNCHPAD_PROGRAM, PlatformConfig, getPdaPlatformId, updatePlatformConfig } from "@raydium-io/raydium-sdk-v2";
import { CU_PRICE_MICROLAMPORTS, priorityLamports, sendUntilLanded } from "./land";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`set ${k}`);
  return v;
};
const loadKeypair = (path: string): Keypair => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));

async function main(): Promise<void> {
  const wantSend = process.argv.includes("--send");
  const approved = process.env.I_HAVE_OWNER_APPROVAL === "yes";
  if (wantSend && !approved) throw new Error("--send refused: I_HAVE_OWNER_APPROVAL=yes is not set");

  const conn = new Connection(env("RPC_URL"), "confirmed");
  const admin = process.env.PLATFORM_ADMIN_KEYPAIR ? loadKeypair(process.env.PLATFORM_ADMIN_KEYPAIR) : undefined;
  const adminPk = admin?.publicKey ?? new PublicKey(env("PLATFORM_ADMIN_PUBKEY"));
  if (wantSend && !admin) throw new Error("--send needs PLATFORM_ADMIN_KEYPAIR");
  const cpCreator = new PublicKey(env("CP_CREATOR"));

  const { publicKey: platformId } = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPk);
  const info = await conn.getAccountInfo(platformId);
  if (!info) throw new Error(`PlatformConfig ${platformId.toBase58()} doesn't exist yet: run create-platform-config.ts first`);
  const p = PlatformConfig.decode(info.data);
  console.log(`PlatformConfig ${platformId.toBase58()}`);
  console.log(`  platform_fee_wallet       ${p.platformClaimFeeWallet.toBase58()}`);
  console.log(`  platform_lock_nft_wallet  ${p.platformLockNftWallet.toBase58()}`);
  console.log(`  platform_cp_creator now   ${p.platformCpCreator.toBase58()}${p.platformCpCreator.equals(PublicKey.default) ? " (unset: the launch creator gets the fee)" : ""}`);
  console.log(`  platform_cp_creator to be ${cpCreator.toBase58()}`);
  if (p.platformCpCreator.equals(cpCreator)) {
    console.log("Already set. Nothing to do.");
    return;
  }
  if (!p.platformClaimFeeWallet.equals(cpCreator)) console.log("NOTE: CP_CREATOR isn't platform_fee_wallet. The worker collects the creator fee only as the fee claimer.");

  const ix = updatePlatformConfig(LAUNCHPAD_PROGRAM, adminPk, platformId, { type: "updatePlatformCpCreator", value: cpCreator });
  const CU_LIMIT = 100_000;
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICROLAMPORTS }),
    ix,
  ];
  const sign = (blockhash: string): VersionedTransaction => {
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: adminPk, recentBlockhash: blockhash, instructions }).compileToV0Message());
    if (admin) tx.sign([admin]);
    return tx;
  };
  const tx = sign((await conn.getLatestBlockhash("confirmed")).blockhash);

  console.log(`priority fee ${priorityLamports(CU_LIMIT)} lamports (CU_PRICE_MICROLAMPORTS ${CU_PRICE_MICROLAMPORTS})`);
  const sim = await conn.simulateTransaction(tx, { sigVerify: !!admin, replaceRecentBlockhash: !admin });
  console.log("simulation err:", JSON.stringify(sim.value.err), "units:", sim.value.unitsConsumed);
  console.log((sim.value.logs ?? []).join("\n"));
  if (!wantSend) {
    console.log("\nDRY RUN — nothing sent.");
    return;
  }
  if (sim.value.err) throw new Error("simulation failed; not sending (if the logs mention the epoch, retry in the next epoch)");
  await sendUntilLanded(
    conn,
    sign,
    async () => {
      const now = await conn.getAccountInfo(platformId, "confirmed");
      return now !== null && PlatformConfig.decode(now.data).platformCpCreator.equals(cpCreator);
    },
    "platform_config.update_cp_creator",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
