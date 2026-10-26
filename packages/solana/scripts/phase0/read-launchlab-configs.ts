/**
 * read-launchlab-configs.ts — READ-ONLY. Never signs, never sends.
 *
 * Fetches and decodes, with the Raydium SDK v2 layouts (@raydium-io/raydium-sdk-v2@0.2.75-alpha,
 * git b69d02b), every LaunchLab GlobalConfig, the PlatformConfigs / CPMM AmmConfigs you list,
 * one pool (given, or the most recently active pool of a config), and checks the deployed
 * on-chain Anchor IDL for the 2026-08 upgrades.
 *
 * Usage:
 *   RPC_URL=https://... npx tsx read-launchlab-configs.ts                 # defaults below
 *   RPC_URL=... npx tsx read-launchlab-configs.ts <addr> [<addr> ...]     # any GlobalConfig/PlatformConfig/AmmConfig/PoolState
 *   RPC_URL=... npx tsx read-launchlab-configs.ts --pool-of <platformConfigOrGlobalConfig>
 *   RPC_URL=... npx tsx read-launchlab-configs.ts --pool <poolStateId>
 *
 * Sources for layouts / seeds (see phase0/launchlab.md):
 *   raydium-sdk-V2@b69d02b src/raydium/launchpad/layout.ts (LaunchpadConfig, LaunchpadPool, PlatformConfig)
 *   raydium-sdk-V2@b69d02b src/raydium/launchpad/pda.ts:62,70 (platform / creator fee vault seeds)
 *   raydium-sdk-V2@b69d02b src/raydium/cpmm/layout.ts:3 (CpmmConfigInfoLayout)
 */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import bs58 from "bs58";
import {
  CREATE_CPMM_POOL_PROGRAM,
  CpmmConfigInfoLayout,
  LAUNCHPAD_PROGRAM,
  LaunchpadConfig,
  LaunchpadPool,
  PlatformConfig,
  getPdaCreatorVault,
  getPdaPlatformVault,
} from "@raydium-io/raydium-sdk-v2";

const DEFAULT_ADDRESSES = [
  // StonkFun PlatformConfigs per HANDOFF §4 (Bitquery) — not verified until this script runs.
  "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7", // "standard"
  "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt", // "reward"
  // CPMM AmmConfig HANDOFF calls "0.25% used at graduation"; derives to CPMM amm_config index 11.
  "CRRS5ieQmBrZjWhcj99JuGrT5tyuWDaGAXLXLFjbAtjQ",
  // CPMM AmmConfig index 0 (raydium-docs-v1 reference/fee-comparison.mdx:17 says 0.25% tier).
  "D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2",
];

const RATE_DEN = 1_000_000; // FEE_RATE_DENOMINATOR_VALUE, raydium-sdk-V2 src/common/fee.ts:2
const disc = (name: string): Buffer => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
const D = {
  GlobalConfig: disc("GlobalConfig"),
  PlatformConfig: disc("PlatformConfig"),
  PoolState: disc("PoolState"),
  AmmConfig: disc("AmmConfig"),
};

const pct = (v: BN | number): string => `${((typeof v === "number" ? v : v.toNumber()) / RATE_DEN) * 100}%`;
const str = (bytes: number[]): string => {
  const b = Buffer.from(bytes);
  const end = b.indexOf(0);
  return b.subarray(0, end === -1 ? b.length : end).toString("utf8");
};

async function tokenBalance(conn: Connection, account: PublicKey): Promise<string> {
  try {
    const b = await conn.getTokenAccountBalance(account, "confirmed");
    return `${b.value.uiAmountString} (raw ${b.value.amount})`;
  } catch {
    return "account not found";
  }
}

function printGlobalConfig(id: PublicKey, data: Buffer): void {
  const c = LaunchpadConfig.decode(data);
  // The SDK layout folds the old requires_platform_auth byte into its padding (layout.ts:25);
  // the IDL (raydium-idl@e7e0c96 raydium_launchpad.json:5075) puts it right after migrate_to_cpswap_wallet.
  const rpaOffset = LaunchpadConfig.offsetOf("migrateToCpmmWallet")! + 32;
  console.log(`\n== GlobalConfig ${id.toBase58()}`);
  console.log({
    curveType: c.curveType,
    index: c.index,
    quoteMint: c.mintB.toBase58(),
    tradeFeeRate: `${c.tradeFeeRate.toString()} (${pct(c.tradeFeeRate)})`,
    maxShareFeeRate: `${c.maxShareFeeRate.toString()} (${pct(c.maxShareFeeRate)}) — bounds referral share_fee_rate only`,
    migrateFee: c.migrateFee.toString(),
    minSupplyA: c.minSupplyA.toString(),
    maxLockRate: pct(c.maxLockRate),
    minSellRateA: pct(c.minSellRateA),
    minMigrateRateA: pct(c.minMigrateRateA),
    minFundRaisingB: c.minFundRaisingB.toString(),
    protocolFeeOwner: c.protocolFeeOwner.toBase58(),
    migrateFeeOwner: c.migrateFeeOwner.toBase58(),
    migrateToCpmmWallet: c.migrateToCpmmWallet.toBase58(),
    byteAtFormerRequiresPlatformAuth: data[rpaOffset],
  });
}

async function printPlatformConfig(conn: Connection, id: PublicKey, data: Buffer): Promise<void> {
  const p = PlatformConfig.decode(data);
  const scaleSum = p.platformScale.add(p.creatorScale).add(p.burnScale);
  console.log(`\n== PlatformConfig ${id.toBase58()} (data ${data.length} bytes; docs say fixed 944)`);
  console.log({
    name: str(p.name),
    web: str(p.web),
    img: str(p.img),
    feeRate: `${p.feeRate.toString()} (${pct(p.feeRate)}) — cap 50000 per docs changelog 2026-08-26`,
    creatorFeeRate: `${p.creatorFeeRate.toString()} (${pct(p.creatorFeeRate)}) — cap 5000 per docs`,
    platformScale: p.platformScale.toString(),
    creatorScale: p.creatorScale.toString(),
    burnScale: p.burnScale.toString(),
    scaleSumIs1e6: scaleSum.eqn(RATE_DEN),
    platformClaimFeeWallet: p.platformClaimFeeWallet.toBase58(),
    platformLockNftWallet: p.platformLockNftWallet.toBase58(),
    cpConfigId: p.cpConfigId.toBase58(),
    platformCpCreator: p.platformCpCreator.toBase58(),
    transferFeeExtensionAuth: p.transferFeeExtensionAuth.toBase58(),
    platformVestingWallet: p.platformVestingWallet.toBase58(),
    platformVestingScale: p.platformVestingScale.toString(),
    restrictGlobalConfig: p.restrictGlobalConfig,
    restrictCurveParam: p.restrictCurveParam,
    curveRuleManager: p.curveRuleManager.toBase58(),
  });
  // Per-platform fee vault, seeds [platform_config, quote_mint] (sdk pda.ts:62).
  const vault = getPdaPlatformVault(LAUNCHPAD_PROGRAM, id, NATIVE_MINT).publicKey;
  console.log(`  platform fee vault (WSOL) ${vault.toBase58()}: ${await tokenBalance(conn, vault)}`);
  const cp = await conn.getAccountInfo(p.cpConfigId);
  if (cp) printAmmConfig(p.cpConfigId, cp.data);
}

function printAmmConfig(id: PublicKey, data: Buffer): void {
  const a = CpmmConfigInfoLayout.decode(data);
  console.log(`\n== CPMM AmmConfig ${id.toBase58()}`);
  console.log({
    index: a.index,
    disableCreatePool: a.disableCreatePool,
    tradeFeeRate: `${a.tradeFeeRate.toString()} (${pct(a.tradeFeeRate)} of volume)`,
    protocolFeeRate: `${a.protocolFeeRate.toString()} (${pct(a.protocolFeeRate)} of trade fee)`,
    fundFeeRate: `${a.fundFeeRate.toString()} (${pct(a.fundFeeRate)} of trade fee)`,
    creatorFeeRate: `${a.creatorFeeRate.toString()} (${pct(a.creatorFeeRate)} of volume)`,
    creatorFeeShareRate: `${a.creatorFeeShareRate.toString()} (${pct(a.creatorFeeShareRate)} of creator fee)`,
    createPoolFee: a.createPoolFee.toString(),
  });
}

async function printPool(conn: Connection, id: PublicKey, data: Buffer): Promise<void> {
  const p = LaunchpadPool.decode(data);
  const locked = p.vestingSchedule.totalLockedAmount;
  const migrateA = p.supply.sub(p.totalSellA).sub(locked);
  console.log(`\n== PoolState ${id.toBase58()}`);
  console.log({
    status: `${p.status} (0 Fund, 1 Migrate, 2 Trade)`,
    migrateType: p.migrateType,
    mintA: p.mintA.toBase58(),
    mintB: p.mintB.toBase58(),
    mintDecimalsA: p.mintDecimalsA,
    mintProgramFlag: `${p.mintProgramFlag} (bit0 base, bit1 quote; 1 = Token-2022)`,
    supply: p.supply.toString(),
    totalSellA: p.totalSellA.toString(),
    totalFundRaisingB: p.totalFundRaisingB.toString(),
    migrateAmountA: migrateA.toString(),
    virtualA: p.virtualA.toString(),
    virtualB: p.virtualB.toString(),
    realA: p.realA.toString(),
    realB: p.realB.toString(),
    protocolFeeCounter: p.protocolFee.toString(),
    platformFeeCounter: p.platformFee.toString(),
    migrateFee: p.migrateFee.toString(),
    totalLockedAmount: locked.toString(),
    creator: p.creator.toBase58(),
    configId: p.configId.toBase58(),
    platformId: p.platformId.toBase58(),
    cpmmCreatorFeeOn: p.cpmmCreatorFeeOn,
  });
  // Progress from pool fields: buys are capped at totalSellA - realA (sdk curve/curve.ts:281-288).
  const progress = p.totalSellA.isZero() ? 0 : p.realA.muln(10000).div(p.totalSellA).toNumber() / 100;
  console.log(`  progress = realA*100/totalSellA = ${progress}%`);
  try {
    const bal = await conn.getTokenAccountBalance(p.vaultA, "confirmed");
    const baseReserve = Number(bal.value.amount) / 10 ** p.mintDecimalsA;
    const handoff = 100 - ((baseReserve - 206_900_000) * 100) / 793_100_000;
    console.log(`  HANDOFF formula on base vault (${baseReserve}) = ${handoff.toFixed(2)}%`);
  } catch {
    console.log("  base vault not readable");
  }
  // Graduation price = (totalFundRaisingB - migrateFee) / migrateAmountA (sdk constantProductCurve.ts:62-64).
  if (!migrateA.isZero()) {
    const tf = p.totalFundRaisingB.sub(p.migrateFee);
    const fdvQuoteRaw = tf.mul(p.supply).div(migrateA); // quote raw units
    console.log(`  graduation FDV ≈ ${fdvQuoteRaw.toString()} quote raw units (${Number(fdvQuoteRaw) / 10 ** p.mintDecimalsB} quote)`);
  }
  const pv = getPdaPlatformVault(LAUNCHPAD_PROGRAM, p.platformId, p.mintB).publicKey;
  const cv = getPdaCreatorVault(LAUNCHPAD_PROGRAM, p.creator, p.mintB).publicKey;
  console.log(`  platform fee vault ${pv.toBase58()}: ${await tokenBalance(conn, pv)}`);
  console.log(`  creator fee vault  ${cv.toBase58()}: ${await tokenBalance(conn, cv)}`);
}

async function printAny(conn: Connection, id: PublicKey): Promise<void> {
  const info = await conn.getAccountInfo(id, "confirmed");
  if (!info) return console.log(`\n== ${id.toBase58()}: account not found`);
  const head = info.data.subarray(0, 8);
  if (info.owner.equals(LAUNCHPAD_PROGRAM)) {
    if (head.equals(D.GlobalConfig)) return printGlobalConfig(id, info.data);
    if (head.equals(D.PlatformConfig)) return printPlatformConfig(conn, id, info.data);
    if (head.equals(D.PoolState)) return printPool(conn, id, info.data);
  }
  if (info.owner.equals(CREATE_CPMM_POOL_PROGRAM) && head.equals(D.AmmConfig)) return printAmmConfig(id, info.data);
  console.log(`\n== ${id.toBase58()}: owner ${info.owner.toBase58()}, unknown account type (${info.data.length} bytes)`);
}

/** Most recently touched pool of a platform or global config (max `epoch`, a recent-epoch tracker). */
async function latestPoolOf(conn: Connection, parent: PublicKey): Promise<PublicKey | undefined> {
  const info = await conn.getAccountInfo(parent);
  const field = info?.data.subarray(0, 8).equals(D.GlobalConfig) ? "configId" : "platformId";
  const list = await conn.getProgramAccounts(LAUNCHPAD_PROGRAM, {
    dataSlice: { offset: 8, length: 8 },
    filters: [
      { dataSize: LaunchpadPool.span },
      { memcmp: { offset: LaunchpadPool.offsetOf(field)!, bytes: parent.toBase58() } },
    ],
  });
  console.log(`\n${list.length} pools have ${field} = ${parent.toBase58()}`);
  let best: { id: PublicKey; epoch: bigint } | undefined;
  for (const a of list) {
    const epoch = a.account.data.readBigUInt64LE(0);
    if (!best || epoch > best.epoch) best = { id: a.pubkey, epoch };
  }
  return best?.id;
}

/** Reads the legacy on-chain `anchor:idl` account and reports which upgrade markers it contains. */
async function checkOnchainIdl(conn: Connection): Promise<void> {
  const [base] = PublicKey.findProgramAddressSync([], LAUNCHPAD_PROGRAM);
  const idlAddr = await PublicKey.createWithSeed(base, "anchor:idl", LAUNCHPAD_PROGRAM);
  const info = await conn.getAccountInfo(idlAddr);
  if (!info) return console.log(`\nOn-chain IDL ${idlAddr.toBase58()}: not found`);
  const len = info.data.readUInt32LE(40);
  const text = inflateSync(info.data.subarray(44, 44 + len)).toString("utf8");
  const markers = [
    "requires_platform_auth", // removed by 2026-08-17 upgrade
    "restrict_global_config", // added 2026-08-17
    "create_platform_allow_config", // added 2026-08-17
    "create_platform_curve_rule", // added 2026-08-31
    "restrict_curve_param", // added 2026-08-31
    "collect_excess_lamports", // added 2026-09-09
  ];
  console.log(`\n== On-chain LaunchLab IDL ${idlAddr.toBase58()} (${text.length} chars)`);
  for (const m of markers) console.log(`  ${m}: ${text.includes(m) ? "present" : "absent"}`);
}

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error("set RPC_URL");
  const conn = new Connection(rpc, "confirmed");
  const args = process.argv.slice(2);

  await checkOnchainIdl(conn);

  // Every GlobalConfig (the docs say the count is single digits).
  const globals = await conn.getProgramAccounts(LAUNCHPAD_PROGRAM, {
    filters: [{ dataSize: LaunchpadConfig.span }, { memcmp: { offset: 0, bytes: bs58.encode(D.GlobalConfig) } }],
  });
  console.log(`\n${globals.length} GlobalConfig accounts`);
  for (const g of globals) printGlobalConfig(g.pubkey, g.account.data);

  const poolOfIdx = args.indexOf("--pool-of");
  const poolIdx = args.indexOf("--pool");
  const plain = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--pool-of" && args[i - 1] !== "--pool");
  for (const a of plain.length ? plain : DEFAULT_ADDRESSES) await printAny(conn, new PublicKey(a));

  const argAfter = (i: number): string => {
    const v = args[i + 1];
    if (!v) throw new Error(`${args[i]} needs an address`);
    return v;
  };
  if (poolIdx >= 0) await printAny(conn, new PublicKey(argAfter(poolIdx)));
  if (poolOfIdx >= 0) {
    const id = await latestPoolOf(conn, new PublicKey(argAfter(poolOfIdx)));
    if (id) await printAny(conn, id);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
