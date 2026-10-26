/**
 * Raydium LaunchLab: create, quote, trade, claim and event decoding.
 *
 * Every builder below is the SDK's own (raydium-sdk-V2@b69d02b, npm 0.2.75-alpha), cited in
 * docs/VERIFIED.md. The high-level `createLaunchpad()` is not used because it can't build a
 * Token-2022 coin without a transfer fee (launchpad.ts:206).
 */
import { createHash } from "node:crypto";
import BN from "bn.js";
import bs58 from "bs58";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type MessageAccountKeys,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  buyExactInInstruction,
  claimCreatorFee,
  claimPlatformFeeFromVault,
  CpmmCreatorFeeOn,
  Curve,
  getPdaCreatorFeeVaultAuth,
  getPdaCreatorVault,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformAllowConfig,
  getPdaPlatformCurveRule,
  getPdaPlatformFeeVaultAuth,
  getPdaPlatformVault,
  initializeWithToken2022,
  LaunchpadConfig,
  LaunchpadPool,
  PlatformConfig,
  sellExactInInstruction,
} from "@raydium-io/raydium-sdk-v2";

export type PoolState = ReturnType<typeof LaunchpadPool.decode>;
export type GlobalConfigState = ReturnType<typeof LaunchpadConfig.decode>;
export type PlatformState = ReturnType<typeof PlatformConfig.decode>;

export const decodePool = (data: Buffer): PoolState => LaunchpadPool.decode(data);
export const decodeGlobalConfig = (data: Buffer): GlobalConfigState => LaunchpadConfig.decode(data);
export const decodePlatform = (data: Buffer): PlatformState => PlatformConfig.decode(data);

/** PoolState.status (IDL PoolStatus: Fund, Migrate, Trade). 2 means migrated to CPMM. */
export const POOL_STATUS = { fund: 0, migrate: 1, trade: 2 } as const;

/** Coins are Token-2022 with 6 decimals (Curve.checkParam requires 6, curve/curve.ts:213). */
export const COIN_DECIMALS = 6;

export function poolAddresses(programId: PublicKey, mint: PublicKey, quoteMint: PublicKey = NATIVE_MINT) {
  const poolId = getPdaLaunchpadPoolId(programId, mint, quoteMint).publicKey;
  return {
    poolId,
    vaultA: getPdaLaunchpadVaultId(programId, poolId, mint).publicKey,
    vaultB: getPdaLaunchpadVaultId(programId, poolId, quoteMint).publicKey,
    auth: getPdaLaunchpadAuth(programId).publicKey,
  };
}

export const platformFeeVault = (programId: PublicKey, platformId: PublicKey, quoteMint: PublicKey = NATIVE_MINT) =>
  getPdaPlatformVault(programId, platformId, quoteMint).publicKey;
export const creatorFeeVault = (programId: PublicKey, creator: PublicKey, quoteMint: PublicKey = NATIVE_MINT) =>
  getPdaCreatorVault(programId, creator, quoteMint).publicKey;

/* ---------- create ---------- */

export interface CreateParams {
  programId: PublicKey;
  payer: PublicKey;
  /** The user's wallet. Recorded as pool_state.creator; not a signer (IDL initialize_with_token_2022). */
  creator: PublicKey;
  globalConfig: PublicKey;
  platformId: PublicKey;
  platform: PlatformState;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  supply: BN;
  totalSellA: BN;
  totalFundRaisingB: BN;
}

/** initialize_with_token_2022, no transfer-fee extension, SOL quote, CPMM migration, zero vesting, no buy. */
export function createInstruction(p: CreateParams): TransactionInstruction {
  if (p.symbol.length > 10) throw new Error("symbol must be at most 10 characters (launchpad.ts:235)");
  if (!p.uri) throw new Error("metadata uri is required");
  const { poolId, vaultA, vaultB, auth } = poolAddresses(p.programId, p.mint);
  const zero = new BN(0);
  const ix = initializeWithToken2022(
    p.programId,
    p.payer,
    p.creator,
    p.globalConfig,
    p.platformId,
    auth,
    poolId,
    p.mint,
    NATIVE_MINT,
    vaultA,
    vaultB,
    TOKEN_PROGRAM_ID,
    COIN_DECIMALS,
    p.name,
    p.symbol,
    p.uri,
    { type: "ConstantCurve", totalSellA: p.totalSellA, migrateType: "cpmm", supply: p.supply, totalFundRaisingB: p.totalFundRaisingB },
    zero,
    zero,
    zero,
    CpmmCreatorFeeOn.OnlyTokenB,
    undefined,
    p.platform.restrictGlobalConfig ? getPdaPlatformAllowConfig(p.programId, p.platformId, p.globalConfig).publicKey : undefined,
    p.platform.restrictCurveParam ? getPdaPlatformCurveRule(p.programId, p.platformId, p.globalConfig).publicKey : undefined,
  );
  // With transferFeeExtensionParams undefined the SDK writes Option tag 0 and then still appends a
  // 10-byte zero struct (instrument.ts:345-346). Borsh Option::None is the tag alone and this is the
  // last argument, so trim the extra bytes (docs/verified/launchlab.md §1c).
  const tail = ix.data.subarray(ix.data.length - 10);
  if (tail.every((b) => b === 0) && ix.data[ix.data.length - 11] === 0) ix.data = ix.data.subarray(0, ix.data.length - 10);
  return ix;
}

export interface CreateTxParams extends CreateParams {
  mintKeypair: Keypair;
  payerKeypair: Keypair;
  recentBlockhash: string;
  cuLimit?: number;
  cuPriceMicroLamports?: number;
  /** Jito tip transfer inside the create transaction (jito-docs lowlatencytxnsend.md:574-579). */
  tip?: { account: PublicKey; lamports: number };
}

export function createTransaction(p: CreateTxParams): VersionedTransaction {
  if (!p.mintKeypair.publicKey.equals(p.mint)) throw new Error("mint keypair mismatch");
  if (!p.payerKeypair.publicKey.equals(p.payer)) throw new Error("payer keypair mismatch");
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: p.cuLimit ?? 400_000 })];
  if (p.cuPriceMicroLamports) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p.cuPriceMicroLamports }));
  ixs.push(createInstruction(p));
  if (p.tip) ixs.push(SystemProgram.transfer({ fromPubkey: p.payer, toPubkey: p.tip.account, lamports: p.tip.lamports }));
  const msg = new TransactionMessage({ payerKey: p.payer, recentBlockhash: p.recentBlockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([p.payerKeypair, p.mintKeypair]);
  return tx;
}

/* ---------- quotes ---------- */

export interface FeeRates {
  protocol: BN;
  platform: BN;
  creator: BN;
}

export const feeRates = (config: GlobalConfigState, platform: PlatformState): FeeRates => ({
  protocol: config.tradeFeeRate,
  platform: platform.feeRate,
  creator: platform.creatorFeeRate,
});

export interface Quote {
  amountIn: BN;
  amountOut: BN;
  platformFee: BN;
  creatorFee: BN;
  protocolFee: BN;
}

/** Exact SOL in → tokens out, using the SDK's curve math (curve/curve.ts:245). */
export function quoteBuy(pool: PoolState, config: GlobalConfigState, rates: FeeRates, lamportsIn: BN): Quote {
  const r = Curve.buyExactIn({
    poolInfo: pool,
    amountB: lamportsIn,
    protocolFeeRate: rates.protocol,
    platformFeeRate: rates.platform,
    creatorFeeRate: rates.creator,
    shareFeeRate: new BN(0),
    curveType: config.curveType,
    transferFeeConfigA: undefined,
    slot: 0,
  });
  return { amountIn: r.amountB, amountOut: r.amountA.amount, platformFee: r.splitFee.platformFee, creatorFee: r.splitFee.creatorFee, protocolFee: r.splitFee.protocolFee };
}

/** Exact tokens in → SOL out (curve/curve.ts:368). */
export function quoteSell(pool: PoolState, config: GlobalConfigState, rates: FeeRates, tokensIn: BN): Quote {
  const r = Curve.sellExactIn({
    poolInfo: pool,
    amountA: tokensIn,
    protocolFeeRate: rates.protocol,
    platformFeeRate: rates.platform,
    creatorFeeRate: rates.creator,
    shareFeeRate: new BN(0),
    curveType: config.curveType,
    transferFeeConfigA: undefined,
    slot: 0,
  });
  return { amountIn: tokensIn, amountOut: r.amountB, platformFee: r.splitFee.platformFee, creatorFee: r.splitFee.creatorFee, protocolFee: r.splitFee.protocolFee };
}

/** SOL per whole token from reserves: (virtualB + realB) / (virtualA − realA), constantProductCurve.ts:32-44. */
export function poolPriceSol(pool: Pick<PoolState, "virtualA" | "virtualB" | "realA" | "realB">): number {
  const quote = pool.virtualB.add(pool.realB);
  const base = pool.virtualA.sub(pool.realA);
  if (base.lten(0)) return 0;
  return quote.toNumber() / 1e9 / (base.toNumber() / 10 ** COIN_DECIMALS);
}

/* ---------- trade instructions (user signs) ---------- */

export interface TradeIxParams {
  programId: PublicKey;
  owner: PublicKey;
  poolId: PublicKey;
  pool: PoolState;
  /** Token program of the coin's mint (Token-2022 for Divvy coins). */
  mintProgramA: PublicKey;
}

function tradeAccounts(p: TradeIxParams) {
  const userA = getAssociatedTokenAddressSync(p.pool.mintA, p.owner, false, p.mintProgramA);
  const userB = getAssociatedTokenAddressSync(NATIVE_MINT, p.owner, false, TOKEN_PROGRAM_ID);
  return {
    userA,
    userB,
    auth: getPdaLaunchpadAuth(p.programId).publicKey,
    platformVault: platformFeeVault(p.programId, p.pool.platformId, p.pool.mintB),
    creatorVault: creatorFeeVault(p.programId, p.pool.creator, p.pool.mintB),
  };
}

/** Wrap SOL, buy with exact SOL in, unwrap leftovers. */
export function buyInstructions(p: TradeIxParams & { lamportsIn: BN; minTokensOut: BN }): TransactionInstruction[] {
  const a = tradeAccounts(p);
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.owner, a.userA, p.owner, p.pool.mintA, p.mintProgramA, ASSOCIATED_TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(p.owner, a.userB, p.owner, NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    SystemProgram.transfer({ fromPubkey: p.owner, toPubkey: a.userB, lamports: BigInt(p.lamportsIn.toString()) }),
    createSyncNativeInstruction(a.userB, TOKEN_PROGRAM_ID),
    buyExactInInstruction(
      p.programId, p.owner, a.auth, p.pool.configId, p.pool.platformId, p.poolId, a.userA, a.userB, p.pool.vaultA, p.pool.vaultB,
      p.pool.mintA, p.pool.mintB, p.mintProgramA, TOKEN_PROGRAM_ID, a.platformVault, a.creatorVault, p.lamportsIn, p.minTokensOut,
    ),
    createCloseAccountInstruction(a.userB, p.owner, p.owner, [], TOKEN_PROGRAM_ID),
  ];
}

/** Sell exact tokens in for SOL; the WSOL account is closed so the user gets native SOL. */
export function sellInstructions(p: TradeIxParams & { tokensIn: BN; minLamportsOut: BN }): TransactionInstruction[] {
  const a = tradeAccounts(p);
  return [
    createAssociatedTokenAccountIdempotentInstruction(p.owner, a.userB, p.owner, NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    sellExactInInstruction(
      p.programId, p.owner, a.auth, p.pool.configId, p.pool.platformId, p.poolId, a.userA, a.userB, p.pool.vaultA, p.pool.vaultB,
      p.pool.mintA, p.pool.mintB, p.mintProgramA, TOKEN_PROGRAM_ID, a.platformVault, a.creatorVault, p.tokensIn, p.minLamportsOut,
    ),
    createCloseAccountInstruction(a.userB, p.owner, p.owner, [], TOKEN_PROGRAM_ID),
  ];
}

/* ---------- fee claims ---------- */

/**
 * claim_platform_fee_from_vault (IDL :732-910): sweeps the shared platform vault into the
 * platform_fee_wallet's WSOL ATA, then unwraps it. Signed by platform_fee_wallet.
 */
export function claimPlatformVaultInstructions(programId: PublicKey, platformId: PublicKey, feeWallet: PublicKey): TransactionInstruction[] {
  const recipient = getAssociatedTokenAddressSync(NATIVE_MINT, feeWallet, false, TOKEN_PROGRAM_ID);
  return [
    createAssociatedTokenAccountIdempotentInstruction(feeWallet, recipient, feeWallet, NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    claimPlatformFeeFromVault(
      programId, platformId, feeWallet, getPdaPlatformFeeVaultAuth(programId).publicKey, platformFeeVault(programId, platformId), recipient, NATIVE_MINT, TOKEN_PROGRAM_ID,
    ),
    createCloseAccountInstruction(recipient, feeWallet, feeWallet, [], TOKEN_PROGRAM_ID),
  ];
}

/** claim_creator_fee (IDL :392-560): the creator signs; covers every coin they created on any platform. */
export function claimCreatorFeeInstructions(programId: PublicKey, creator: PublicKey): TransactionInstruction[] {
  const recipient = getAssociatedTokenAddressSync(NATIVE_MINT, creator, false, TOKEN_PROGRAM_ID);
  return [
    createAssociatedTokenAccountIdempotentInstruction(creator, recipient, creator, NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    claimCreatorFee(programId, creator, getPdaCreatorFeeVaultAuth(programId).publicKey, creatorFeeVault(programId, creator), recipient, NATIVE_MINT, TOKEN_PROGRAM_ID),
    createCloseAccountInstruction(recipient, creator, creator, [], TOKEN_PROGRAM_ID),
  ];
}

/* ---------- event decoding ---------- */

const disc = (s: string) => createHash("sha256").update(s).digest().subarray(0, 8);
/** Anchor emit_cpi! prefix: EVENT_IX_TAG (sha256("anchor:event")[..8] = 0x1d9acb512ea545e4) little-endian. */
export const EVENT_IX_TAG_LE = Buffer.from(disc("anchor:event")).reverse();
/** IDL events (raydium-idl raydium_launchpad.json "events"), equal to sha256("event:<Name>")[..8]. */
export const TRADE_EVENT_DISC = disc("event:TradeEvent");
export const POOL_CREATE_EVENT_DISC = disc("event:PoolCreateEvent");
const TRADE_IX_DISCS = ["buy_exact_in", "buy_exact_out", "sell_exact_in", "sell_exact_out"].map((n) => disc("global:" + n));
/** raydium-cp-swap initialize_with_permission; pool_state is account index 4 (initialize_with_permission.rs). */
export const CPMM_INIT_WITH_PERMISSION_DISC = disc("global:initialize_with_permission");

export class EventLayoutError extends Error {}

export interface TradeEvent {
  poolState: PublicKey;
  totalBaseSell: bigint;
  virtualBase: bigint;
  virtualQuote: bigint;
  realBaseBefore: bigint;
  realQuoteBefore: bigint;
  realBaseAfter: bigint;
  realQuoteAfter: bigint;
  amountIn: bigint;
  amountOut: bigint;
  protocolFee: bigint;
  platformFee: bigint;
  creatorFee: bigint;
  shareFee: bigint;
  side: "buy" | "sell";
  poolStatus: number;
  exactIn: boolean;
}

/**
 * TradeEvent layout from raydium-idl@e7e0c96 (May 2026). The IDL predates later program upgrades, so
 * every decoded event is sanity-checked; a failure raises EventLayoutError for the indexer to alert on.
 */
export function decodeTradeEvent(body: Buffer): TradeEvent {
  if (body.length < 139) throw new EventLayoutError(`TradeEvent too short: ${body.length}`);
  let o = 0;
  const pk = () => {
    const v = new PublicKey(body.subarray(o, o + 32));
    o += 32;
    return v;
  };
  const u64 = () => {
    const v = body.readBigUInt64LE(o);
    o += 8;
    return v;
  };
  const poolState = pk();
  const [totalBaseSell, virtualBase, virtualQuote, realBaseBefore, realQuoteBefore, realBaseAfter, realQuoteAfter, amountIn, amountOut, protocolFee, platformFee, creatorFee, shareFee] =
    Array.from({ length: 13 }, u64) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  const dir = body[o++]!;
  const poolStatus = body[o++]!;
  const exact = body[o++]!;
  const ev: TradeEvent = {
    poolState, totalBaseSell, virtualBase, virtualQuote, realBaseBefore, realQuoteBefore, realBaseAfter, realQuoteAfter,
    amountIn, amountOut, protocolFee, platformFee, creatorFee, shareFee,
    side: dir === 0 ? "buy" : "sell", poolStatus, exactIn: exact === 1,
  };
  const fees = protocolFee + platformFee + creatorFee + shareFee;
  const gross = ev.side === "buy" ? amountIn : amountOut + fees;
  const ok =
    dir <= 1 && poolStatus <= 2 && exact <= 1 &&
    realBaseAfter <= totalBaseSell &&
    (ev.side === "buy" ? realBaseAfter >= realBaseBefore : realBaseAfter <= realBaseBefore) &&
    fees * 10n <= gross; // fees are well under 10% of the quote leg
  if (!ok) throw new EventLayoutError("TradeEvent failed sanity checks; the on-chain layout may have changed");
  return ev;
}

export interface ParsedTrade {
  ix: number;
  event: TradeEvent;
  /** Signer of the buy/sell instruction (account 0). */
  trader: PublicKey | null;
}

export interface ParsedLaunchLabTx {
  trades: ParsedTrade[];
  poolCreates: { ix: number; poolState: PublicKey; creator: PublicKey }[];
  /** CPMM pool created by a migration in this transaction. */
  cpmmPools: { lpPool: PublicKey; token0: PublicKey; token1: PublicKey }[];
}

const startsWith = (data: Buffer, prefix: Buffer) => data.length >= prefix.length && data.subarray(0, prefix.length).equals(prefix);

/** Pulls TradeEvents (emitted via event CPI, so they're inner instructions), creates and migrations from a transaction. */
export function parseLaunchLabTransaction(tx: VersionedTransactionResponse, launchLab: PublicKey, cpmm: PublicKey): ParsedLaunchLabTx {
  const out: ParsedLaunchLabTx = { trades: [], poolCreates: [], cpmmPools: [] };
  if (!tx.meta || tx.meta.err) return out;
  const keys: MessageAccountKeys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const outer = tx.transaction.message.compiledInstructions;
  let seq = 0;
  const isTradeIx = (programIdIndex: number, data: Buffer) => keys.get(programIdIndex)?.equals(launchLab) && TRADE_IX_DISCS.some((d) => startsWith(data, d));

  for (const group of tx.meta.innerInstructions ?? []) {
    const parent = outer[group.index];
    let trader: PublicKey | null = null;
    if (parent && isTradeIx(parent.programIdIndex, Buffer.from(parent.data))) trader = keys.get(parent.accountKeyIndexes[0]!) ?? null;
    for (const inner of group.instructions) {
      const data = Buffer.from(bs58.decode(inner.data));
      const prog = keys.get(inner.programIdIndex);
      if (!prog) continue;
      if (prog.equals(launchLab) && isTradeIx(inner.programIdIndex, data)) {
        trader = keys.get(inner.accounts[0]!) ?? null;
        continue;
      }
      if (prog.equals(launchLab) && startsWith(data, EVENT_IX_TAG_LE)) {
        const body = data.subarray(8);
        if (startsWith(body, TRADE_EVENT_DISC)) out.trades.push({ ix: seq, event: decodeTradeEvent(body.subarray(8)), trader });
        // PoolCreateEvent: discriminator (8), pool_state (32), creator (32), ...
        else if (startsWith(body, POOL_CREATE_EVENT_DISC)) out.poolCreates.push({ ix: seq, poolState: new PublicKey(body.subarray(8, 40)), creator: new PublicKey(body.subarray(40, 72)) });
      } else if (prog.equals(cpmm) && startsWith(data, CPMM_INIT_WITH_PERMISSION_DISC)) {
        const k = (i: number) => keys.get(inner.accounts[i]!)!;
        out.cpmmPools.push({ lpPool: k(4), token0: k(5), token1: k(6) });
      }
      seq++;
    }
  }
  return out;
}

export { TOKEN_2022_PROGRAM_ID, NATIVE_MINT };
