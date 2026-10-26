/**
 * test-launch.ts — builds a LaunchLab `initialize_with_token_2022` create for a tiny TEST coin on a
 * PlatformConfig (Divvy's), Token-2022 base mint WITHOUT a transfer-fee extension, quote = SOL,
 * migrate_type = cpmm, zero vesting, NO dev buy. Prints the tx and SIMULATES it.
 *
 * DEFAULT IS DRY RUN. It only sends when BOTH `--send` is passed AND env I_HAVE_OWNER_APPROVAL=yes.
 *
 * Mint privacy (HANDOFF §3.5, CLAUDE.md rule 6):
 *   - The dry run simulates with a THROWAWAY mint keypair, so the simulated address never goes live.
 *   - `--send` builds again with a FRESH mint, puts the Jito tip transfer inside the same transaction
 *     (jito-docs lowlatencytxnsend.md:574), and submits it ONLY as a Jito bundle. It never calls
 *     sendRawTransaction or simulates the live transaction on an RPC.
 *
 * Usage:
 *   RPC_URL=... LAUNCHER_PUBKEY=<pk> PLATFORM_ID=<divvy platform config> npx tsx test-launch.ts
 *   RPC_URL=... LAUNCHER_KEYPAIR=/path/launcher.json PLATFORM_ID=... npx tsx test-launch.ts   # signed simulation
 *   ... I_HAVE_OWNER_APPROVAL=yes JITO_TIP_LAMPORTS=100000 npx tsx test-launch.ts --send
 *
 * Env (defaults in brackets):
 *   CREATOR [launcher]   recorded as pool_state.creator; NOT a signer (IDL initialize_with_token_2022.creator)
 *   GLOBAL_CONFIG [LAUNCHPAD_CONFIG = SOL constant-product index 0]
 *   NAME [Divvy Test] SYMBOL [DVTEST] URI [https://example.com/divvy-test.json]
 *   SUPPLY / TOTAL_SELL / FUND_RAISING [SDK LaunchpadPoolInitParam: 1e15 / 7.931e14 / 85e9]
 *   CU_LIMIT [400000] CU_PRICE_MICROLAMPORTS [0]   OUT [test-launch.tx.b64]
 *   KEEP_SDK_TRAILING_BYTES [unset] set to 1 to keep the SDK's 10 trailing zero bytes after Option::None
 *   JITO_TIP_LAMPORTS [100000]  JITO_BLOCK_ENGINE_URL [mainnet.block-engine.jito.wtf]  (send only)
 *
 * SDK API used (raydium-sdk-V2@b69d02b, npm 0.2.75-alpha):
 *   initializeWithToken2022()  src/raydium/launchpad/instrument.ts:242 — called directly because the
 *     high-level createLaunchpad() forces `token2022 = !!transferFeeExtensionParams`
 *     (src/raydium/launchpad/launchpad.ts:206), i.e. it can only build the Token-2022 path WITH a
 *     transfer fee; and it fetches API configs (launchpad.ts:238).
 *   getPdaLaunchpadAuth/PoolId/VaultId, getPdaPlatformAllowConfig, getPdaPlatformCurveRule  src/raydium/launchpad/pda.ts
 *   Curve.checkParam / Curve.getCurve(0).getInitParam  src/raydium/launchpad/curve/curve.ts:196, constantProductCurve.ts:88
 *   LaunchpadPoolInitParam  src/raydium/launchpad/launchpad.ts:100
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { JitoClient, MIN_TIP_LAMPORTS } from "./jito-bundle";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import {
  CpmmCreatorFeeOn,
  Curve,
  LAUNCHPAD_CONFIG,
  LAUNCHPAD_PROGRAM,
  LaunchpadConfig,
  LaunchpadPoolInitParam,
  PlatformConfig,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformAllowConfig,
  getPdaPlatformCurveRule,
  initializeWithToken2022,
} from "@raydium-io/raydium-sdk-v2";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`set ${k}`);
  return v;
};
const loadKeypair = (path: string): Keypair => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));

export interface TestLaunch {
  tx: VersionedTransaction;
  mint: PublicKey;
  poolId: PublicKey;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface JitoTip {
  account: PublicKey;
  lamports: number;
}

export async function buildTestLaunchTx(conn: Connection, payer: PublicKey, signers: Keypair[], tip?: JitoTip): Promise<TestLaunch> {
  const programId = LAUNCHPAD_PROGRAM;
  const creator = new PublicKey(env("CREATOR", payer.toBase58()));
  const platformId = new PublicKey(env("PLATFORM_ID"));
  const configId = new PublicKey(env("GLOBAL_CONFIG", LAUNCHPAD_CONFIG.toBase58()));
  const name = env("NAME", "Divvy Test");
  const symbol = env("SYMBOL", "DVTEST");
  const uri = env("URI", "https://example.com/divvy-test.json");
  const supply = new BN(env("SUPPLY", LaunchpadPoolInitParam.supply.toString()));
  const totalSellA = new BN(env("TOTAL_SELL", LaunchpadPoolInitParam.totalSellA.toString()));
  const totalFundRaisingB = new BN(env("FUND_RAISING", LaunchpadPoolInitParam.totalFundRaisingB.toString()));
  const decimals = 6; // Curve.checkParam requires 6 (curve.ts:213)
  if (symbol.length > 10) throw new Error("symbol must be <= 10 chars (launchpad.ts:235)");

  const [gInfo, pInfo] = await conn.getMultipleAccountsInfo([configId, platformId]);
  if (!gInfo) throw new Error(`GlobalConfig ${configId.toBase58()} not found`);
  if (!pInfo) throw new Error(`PlatformConfig ${platformId.toBase58()} not found`);
  const config = LaunchpadConfig.decode(gInfo.data);
  const platform = PlatformConfig.decode(pInfo.data);
  if (config.curveType !== 0) throw new Error("expected a constant-product GlobalConfig (curveType 0)");
  if (!config.mintB.equals(NATIVE_MINT)) throw new Error("GlobalConfig quote mint is not SOL");

  // Same client-side checks createLaunchpad runs (launchpad.ts:318-340).
  const zero = new BN(0);
  const init = Curve.getCurve(0).getInitParam({ supply, totalFundRaising: totalFundRaisingB, totalSell: totalSellA, totalLockedAmount: zero, migrateFee: config.migrateFee });
  Curve.checkParam({ supply, totalFundRaising: totalFundRaisingB, totalSell: init.c, totalLockedAmount: zero, decimals, config, migrateType: "cpmm" });
  console.log(`expected virtualA ${init.a} virtualB ${init.b}; trader fee = ${config.tradeFeeRate} + ${platform.feeRate} + ${platform.creatorFeeRate} (/1e6)`);

  const mint = Keypair.generate();
  const auth = getPdaLaunchpadAuth(programId).publicKey;
  const poolId = getPdaLaunchpadPoolId(programId, mint.publicKey, NATIVE_MINT).publicKey;
  const vaultA = getPdaLaunchpadVaultId(programId, poolId, mint.publicKey).publicKey;
  const vaultB = getPdaLaunchpadVaultId(programId, poolId, NATIVE_MINT).publicKey;
  // Optional remaining accounts, required only when the platform turned the restriction on.
  const allowPda = platform.restrictGlobalConfig ? getPdaPlatformAllowConfig(programId, platformId, configId).publicKey : undefined;
  const rulePda = platform.restrictCurveParam ? getPdaPlatformCurveRule(programId, platformId, configId).publicKey : undefined;

  const ix = initializeWithToken2022(
    programId,
    payer, // payer: writable signer, pays rent
    creator, // creator: not a signer
    configId,
    platformId,
    auth,
    poolId,
    mint.publicKey,
    NATIVE_MINT,
    vaultA,
    vaultB,
    TOKEN_PROGRAM_ID, // quote (WSOL) token program
    decimals,
    name,
    symbol,
    uri,
    { type: "ConstantCurve", totalSellA, migrateType: "cpmm", supply, totalFundRaisingB },
    zero, // totalLockedAmount
    zero, // cliffPeriod
    zero, // unlockPeriod
    CpmmCreatorFeeOn.OnlyTokenB, // post-graduation CPMM creator fee on quote (SOL) only
    undefined, // transferFeeExtensionParams: omitted -> Option::None, no TransferFeeConfig extension
    allowPda,
    rulePda,
  );
  // With transferFeeExtensionParams undefined the SDK writes the Option tag 0 but still appends the
  // 10-byte {u16,u64} struct (instrument.ts:284-285, 345-346). Borsh `Option::None` is the tag byte
  // only, and the IDL arg is the last one (raydium_launchpad.json initialize_with_token_2022 args), so
  // trim those 10 zero bytes. Set KEEP_SDK_TRAILING_BYTES=1 to simulate the raw SDK bytes instead.
  if (process.env.KEEP_SDK_TRAILING_BYTES !== "1") {
    const tail = ix.data.subarray(ix.data.length - 10);
    if (!tail.every((b) => b === 0) || ix.data[ix.data.length - 11] !== 0) throw new Error("unexpected ix data tail");
    ix.data = ix.data.subarray(0, ix.data.length - 10);
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: Number(env("CU_LIMIT", "400000")) })];
  const cuPrice = Number(env("CU_PRICE_MICROLAMPORTS", "0"));
  if (cuPrice > 0) instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }));
  instructions.push(ix);
  // Tip inside the create tx, tip account as a static key (no ALT): jito-docs lowlatencytxnsend.md:574-579.
  if (tip) instructions.push(SystemProgram.transfer({ fromPubkey: payer, toPubkey: tip.account, lamports: tip.lamports }));
  const msg =new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([mint, ...signers]); // mint keypair must sign (base_mint is a signer); payer signs if its key is loaded

  console.log({ mint: mint.publicKey.toBase58(), poolId: poolId.toBase58(), vaultA: vaultA.toBase58(), vaultB: vaultB.toBase58(), creator: creator.toBase58(), payer: payer.toBase58(), allowPda: allowPda?.toBase58(), rulePda: rulePda?.toBase58() });
  return { tx, mint: mint.publicKey, poolId, blockhash, lastValidBlockHeight };
}

async function main(): Promise<void> {
  const wantSend = process.argv.includes("--send");
  if (wantSend && process.env.I_HAVE_OWNER_APPROVAL !== "yes") throw new Error("--send refused: I_HAVE_OWNER_APPROVAL=yes is not set");
  const conn = new Connection(env("RPC_URL"), "confirmed");
  const launcher = process.env.LAUNCHER_KEYPAIR ? loadKeypair(process.env.LAUNCHER_KEYPAIR) : undefined;
  const payer = launcher?.publicKey ?? new PublicKey(env("LAUNCHER_PUBKEY"));
  if (wantSend && !launcher) throw new Error("--send needs LAUNCHER_KEYPAIR");

  // 1) Dry run with a throwaway mint. This address is simulated on the RPC and then discarded.
  const dry = await buildTestLaunchTx(conn, payer, launcher ? [launcher] : []);
  const b64 = Buffer.from(dry.tx.serialize()).toString("base64");
  const out = env("OUT", "test-launch.tx.b64");
  writeFileSync(out, b64 + "\n");
  console.log(`dry-run tx (${dry.tx.serialize().length} bytes, throwaway mint) base64 written to ${out}`);

  const sim = await conn.simulateTransaction(dry.tx, { sigVerify: !!launcher, replaceRecentBlockhash: !launcher });
  console.log("simulation err:", JSON.stringify(sim.value.err), "units:", sim.value.unitsConsumed);
  console.log((sim.value.logs ?? []).join("\n"));

  if (!wantSend) return console.log("\nDRY RUN — nothing sent. Rerun with --send after owner approval.");
  if (sim.value.err) throw new Error("simulation failed; not sending");
  if (!launcher) throw new Error("--send needs LAUNCHER_KEYPAIR");

  // 2) Live create: fresh mint, tip inside the tx, private Jito bundle only. Never sendRawTransaction.
  const jito = new JitoClient();
  const tipAccounts = await jito.getTipAccounts();
  const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
  if (!tipAccount) throw new Error("getTipAccounts returned nothing");
  const tipLamports = Number(env("JITO_TIP_LAMPORTS", "100000"));
  if (!Number.isInteger(tipLamports) || tipLamports < MIN_TIP_LAMPORTS) throw new Error(`JITO_TIP_LAMPORTS must be an integer >= ${MIN_TIP_LAMPORTS}`);
  const live = await buildTestLaunchTx(conn, payer, [launcher], { account: new PublicKey(tipAccount), lamports: tipLamports });
  const liveB64 = Buffer.from(live.tx.serialize()).toString("base64");
  const bundleId = await jito.sendBundle([liveB64], { approved: true });
  console.log(`launch.create bundle ${bundleId} tip ${tipLamports} lamports to ${tipAccount}`);
  const status = await jito.pollBundle(bundleId, 90_000);
  console.log(JSON.stringify(status, null, 2));
  if (status.inflight?.status === "Landed") console.log(`LANDED — mint ${live.mint.toBase58()} pool ${live.poolId.toBase58()}`);
  else console.log("Not landed. The mint address was never broadcast; nothing to clean up.");
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
