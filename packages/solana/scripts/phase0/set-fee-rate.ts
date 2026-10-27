/**
 * set-fee-rate.ts — changes PlatformConfig.fee_rate, uspad's platform fee on every curve trade, and
 * SIMULATES it.
 *
 * DEFAULT IS DRY RUN. It only sends when BOTH `--send` is passed AND env I_HAVE_OWNER_APPROVAL=yes.
 * The owner decided on 2026-10-27 to raise uspad's share from 0.10% to 0.35%: fee_rate 6000 → 8500,
 * so a trade pays 0.25% Raydium + 0.50% holders + 0.15% creator + 0.35% uspad = 1.25%.
 * The program reads fee_rate from the PlatformConfig on every trade (a pool stores no rate), so the
 * change applies at once to every coin still on its curve (docs/VERIFIED.md item 28).
 *
 * Usage (dry run with just a pubkey):
 *   RPC_URL=... PLATFORM_ADMIN_PUBKEY=<admin> FEE_RATE=8500 npx tsx set-fee-rate.ts
 * Usage (send; updates are rate-limited per epoch, so the simulation may say to wait for the next one):
 *   RPC_URL=... PLATFORM_ADMIN_KEYPAIR=/path/admin.json FEE_RATE=8500 I_HAVE_OWNER_APPROVAL=yes npx tsx set-fee-rate.ts --send
 *
 * On landing it prints `FEE_RATE_SLOT=<slot>`: trades up to that slot are taken as paying the old rate, and
 * go-live.sh fee-rate turns it into FEE_SPLIT_BEFORE so the worker splits them at the old weights.
 *
 * SDK API used (raydium-sdk-V2@b69d02b, npm 0.2.75-alpha):
 *   updatePlatformConfig({ type: "updateFeeRate", value: BN })  src/raydium/launchpad/instrument.ts:837-976
 *   getPdaPlatformId()                                           src/raydium/launchpad/pda.ts:54
 *   PlatformConfig.feeRate / creatorFeeRate                      src/raydium/launchpad/layout.ts:106-136
 *   LaunchpadConfig.tradeFeeRate                                 src/raydium/launchpad/layout.ts:5-26
 */
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { LAUNCHPAD_CONFIG, LAUNCHPAD_PROGRAM, LaunchpadConfig, PlatformConfig, getPdaPlatformId, updatePlatformConfig } from "@raydium-io/raydium-sdk-v2";
import { CU_PRICE_MICROLAMPORTS, priorityLamports, sendUntilLanded } from "./land";

const RATE_DEN = 1_000_000;
const MAX_PLATFORM_FEE_RATE = 50_000; // docs reference/changelog/2026-08-26-launchlab-platform-fee-rate-cap.mdx:18

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`set ${k}`);
  return v;
};
const loadKeypair = (path: string): Keypair => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
const pct = (rate: BN | number) => `${+((Number(rate.toString()) / RATE_DEN) * 100).toFixed(4)}%`;

async function main(): Promise<void> {
  const wantSend = process.argv.includes("--send");
  const approved = process.env.I_HAVE_OWNER_APPROVAL === "yes";
  if (wantSend && !approved) throw new Error("--send refused: I_HAVE_OWNER_APPROVAL=yes is not set");

  const conn = new Connection(env("RPC_URL"), "confirmed");
  const admin = process.env.PLATFORM_ADMIN_KEYPAIR ? loadKeypair(process.env.PLATFORM_ADMIN_KEYPAIR) : undefined;
  const adminPk = admin?.publicKey ?? new PublicKey(env("PLATFORM_ADMIN_PUBKEY"));
  if (wantSend && !admin) throw new Error("--send needs PLATFORM_ADMIN_KEYPAIR");
  const feeRate = new BN(env("FEE_RATE"));
  if (feeRate.isNeg() || feeRate.gtn(MAX_PLATFORM_FEE_RATE)) throw new Error(`FEE_RATE must be 0..${MAX_PLATFORM_FEE_RATE}`);

  const { publicKey: platformId } = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPk);
  const info = await conn.getAccountInfo(platformId);
  if (!info) throw new Error(`PlatformConfig ${platformId.toBase58()} doesn't exist`);
  const p = PlatformConfig.decode(info.data);
  const globalInfo = await conn.getAccountInfo(LAUNCHPAD_CONFIG);
  if (!globalInfo) throw new Error(`GlobalConfig ${LAUNCHPAD_CONFIG.toBase58()} not found`);
  const trade = LaunchpadConfig.decode(globalInfo.data).tradeFeeRate;
  const total = (platform: BN) => pct(trade.add(platform).add(p.creatorFeeRate));
  console.log(`PlatformConfig ${platformId.toBase58()}`);
  console.log(`  Raydium trade_fee_rate    ${trade} (${pct(trade)})`);
  console.log(`  creator_fee_rate          ${p.creatorFeeRate} (${pct(p.creatorFeeRate)}), unchanged`);
  console.log(`  fee_rate now              ${p.feeRate} (${pct(p.feeRate)}), a trade pays ${total(p.feeRate)}`);
  console.log(`  fee_rate to be            ${feeRate} (${pct(feeRate)}), a trade pays ${total(feeRate)}`);
  if (p.feeRate.eq(feeRate)) {
    console.log("Already set. Nothing to do.");
    return;
  }

  const ix = updatePlatformConfig(LAUNCHPAD_PROGRAM, adminPk, platformId, { type: "updateFeeRate", value: feeRate });
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
  const sig = await sendUntilLanded(
    conn,
    sign,
    async () => {
      const now = await conn.getAccountInfo(platformId, "confirmed");
      return now !== null && PlatformConfig.decode(now.data).feeRate.eq(feeRate);
    },
    "platform_config.update_fee_rate",
  );
  if (!sig) return;
  const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
  if (!st) throw new Error(`landed but no status for ${sig}: find its slot on an explorer`);
  console.log(`FEE_RATE_SLOT=${st.slot}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
