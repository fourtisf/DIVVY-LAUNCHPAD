/**
 * create-platform-config.ts — builds Divvy's LaunchLab PlatformConfig creation and SIMULATES it.
 *
 * DEFAULT IS DRY RUN. It only sends when BOTH `--send` is passed AND env I_HAVE_OWNER_APPROVAL=yes.
 * Creating a PlatformConfig is a one-time, owner-approved mainnet action (HANDOFF §1 rule 4).
 *
 * Usage (dry run; works with just a pubkey, simulation skips signature checks):
 *   RPC_URL=... PLATFORM_ADMIN_PUBKEY=<pubkey> npx tsx create-platform-config.ts
 * Usage (signed simulation / send):
 *   RPC_URL=... PLATFORM_ADMIN_KEYPAIR=/path/admin.json npx tsx create-platform-config.ts
 *   RPC_URL=... PLATFORM_ADMIN_KEYPAIR=/path/admin.json I_HAVE_OWNER_APPROVAL=yes npx tsx create-platform-config.ts --send
 *
 * Env (defaults in brackets):
 *   FEE_RATE [6000 = 0.60%]           platform fee_rate, 1/1_000_000; docs cap 50000 (500 bps)
 *   CREATOR_FEE_RATE [1500 = 0.15%]   creator_fee_rate; docs cap MAX_CREATOR_FEE_RATE = 5000
 *   PLATFORM_SCALE [1000000] BURN_SCALE [0]   LP split at graduation; creator_scale is forced to 0
 *   CP_CONFIG_ID [D4FPEru…BvC2 = CPMM AmmConfig index 0, the 0.25% tier per docs]
 *   FEE_WALLET, NFT_WALLET, TRANSFER_FEE_AUTH [admin]   VESTING_WALLET [11111111111111111111111111111111]
 *   GLOBAL_CONFIG [LAUNCHPAD_CONFIG = SOL constant-product index 0] (read only, to print the total fee)
 *   NAME [Divvy] WEB / IMG [example.com placeholders; WEB and IMG must be set explicitly for --send]
 *
 * SDK API used (raydium-sdk-V2@b69d02b, npm 0.2.75-alpha):
 *   createPlatformConfig()  src/raydium/launchpad/instrument.ts:758  (instruction builder)
 *   getPdaPlatformId()      src/raydium/launchpad/pda.ts:54          (seeds ["platform_config", admin])
 *   PlatformConfig / LaunchpadConfig layouts   src/raydium/launchpad/layout.ts:106 / :5
 *   CpmmConfigInfoLayout    src/raydium/cpmm/layout.ts:3
 */
import { readFileSync } from "node:fs";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  CpmmConfigInfoLayout,
  LAUNCHPAD_CONFIG,
  LAUNCHPAD_PROGRAM,
  LaunchpadConfig,
  PlatformConfig,
  createPlatformConfig,
  getPdaPlatformId,
} from "@raydium-io/raydium-sdk-v2";

const RATE_DEN = 1_000_000;
const MAX_PLATFORM_FEE_RATE = 50_000; // docs reference/changelog/2026-08-26-launchlab-platform-fee-rate-cap.mdx:18
const MAX_CREATOR_FEE_RATE = 5_000; // docs products/launchlab/platform-config.mdx:42

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

  const feeRate = new BN(env("FEE_RATE", "6000"));
  const creatorFeeRate = new BN(env("CREATOR_FEE_RATE", "1500"));
  const platformScale = new BN(env("PLATFORM_SCALE", "1000000"));
  const burnScale = new BN(env("BURN_SCALE", "0"));
  const creatorScale = new BN(0); // program asserts creator_scale == 0 (docs platform-config.mdx:72)
  if (feeRate.gtn(MAX_PLATFORM_FEE_RATE)) throw new Error(`FEE_RATE > ${MAX_PLATFORM_FEE_RATE}`);
  if (creatorFeeRate.gtn(MAX_CREATOR_FEE_RATE)) throw new Error(`CREATOR_FEE_RATE > ${MAX_CREATOR_FEE_RATE}`);
  if (!platformScale.add(creatorScale).add(burnScale).eqn(RATE_DEN)) throw new Error("scales must sum to 1_000_000");

  const cpConfigId = new PublicKey(env("CP_CONFIG_ID", "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2"));
  const feeWallet = new PublicKey(env("FEE_WALLET", adminPk.toBase58()));
  const nftWallet = new PublicKey(env("NFT_WALLET", adminPk.toBase58()));
  const transferFeeAuth = new PublicKey(env("TRANSFER_FEE_AUTH", adminPk.toBase58()));
  const vestingWallet = new PublicKey(env("VESTING_WALLET", PublicKey.default.toBase58()));
  const globalConfig = new PublicKey(env("GLOBAL_CONFIG", LAUNCHPAD_CONFIG.toBase58()));

  // Show what a trader will pay: the protocol trade_fee_rate is ADDED to fee_rate and creator_fee_rate
  // (sdk src/raydium/launchpad/curve/curve.ts:501-515 totalFeeRate).
  const g = await conn.getAccountInfo(globalConfig);
  if (g) {
    const gc = LaunchpadConfig.decode(g.data);
    const total = gc.tradeFeeRate.add(feeRate).add(creatorFeeRate);
    console.log(
      `GlobalConfig ${globalConfig.toBase58()}: trade_fee_rate ${gc.tradeFeeRate} -> trader pays ` +
        `${gc.tradeFeeRate} + ${feeRate} + ${creatorFeeRate} = ${total} (${(total.toNumber() / RATE_DEN) * 100}%) per curve trade`,
    );
  } else console.log(`GlobalConfig ${globalConfig.toBase58()} not found`);

  const cp = await conn.getAccountInfo(cpConfigId);
  if (!cp) throw new Error(`CP_CONFIG_ID ${cpConfigId.toBase58()} not found`);
  const amm = CpmmConfigInfoLayout.decode(cp.data);
  console.log(
    `CPMM AmmConfig ${cpConfigId.toBase58()} index ${amm.index}: trade_fee_rate ${amm.tradeFeeRate}, ` +
      `creator_fee_rate ${amm.creatorFeeRate}, creator_fee_share_rate ${amm.creatorFeeShareRate}`,
  );

  const { publicKey: platformId } = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPk);
  const existing = await conn.getAccountInfo(platformId);
  if (existing) {
    const p = PlatformConfig.decode(existing.data);
    console.log(`PlatformConfig ${platformId.toBase58()} ALREADY EXISTS (one per admin wallet). feeRate ${p.feeRate}, creatorFeeRate ${p.creatorFeeRate}`);
    return;
  }

  const ix = createPlatformConfig(
    LAUNCHPAD_PROGRAM,
    adminPk,
    feeWallet,
    nftWallet,
    vestingWallet,
    platformId,
    cpConfigId,
    transferFeeAuth,
    { platformScale, creatorScale, burnScale },
    feeRate,
    creatorFeeRate,
    env("NAME", "Divvy"),
    wantSend ? env("WEB") : env("WEB", "https://example.com"),
    wantSend ? env("IMG") : env("IMG", "https://example.com/logo.png"),
    new BN(0), // platformVestingScale
  );

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: adminPk,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  if (admin) tx.sign([admin]);

  console.log(`\nPlatformConfig PDA to be created: ${platformId.toBase58()}`);
  console.log(`fee_rate ${feeRate} creator_fee_rate ${creatorFeeRate} scales ${platformScale}/${creatorScale}/${burnScale}`);
  const sim = await conn.simulateTransaction(tx, { sigVerify: !!admin, replaceRecentBlockhash: !admin });
  console.log("simulation err:", JSON.stringify(sim.value.err), "units:", sim.value.unitsConsumed);
  console.log((sim.value.logs ?? []).join("\n"));

  if (!wantSend) {
    console.log("\nDRY RUN — nothing sent. Follow-ups after creation (separate update_platform_config calls):");
    console.log("  updatePlatformCpCreator (set the post-graduation CPMM creator-fee beneficiary), see docs redistribute-creator-fees.mdx");
    return;
  }
  if (sim.value.err) throw new Error("simulation failed; not sending");
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`SENT ${sig} — PlatformConfig ${platformId.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
