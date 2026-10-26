/**
 * Everything the dividend engine does on chain, behind one interface so the engine can be tested
 * with a stub and so dry-run never reaches a signing path.
 *
 * Every send takes an `onSigned` callback that runs after signing and before sending: the engine
 * records the signature first, so a crash between "sent" and "recorded" can be recovered with
 * `outcome()` instead of losing track of money.
 */
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TokenBalance,
  type TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expectedOnChainRates } from "@divvy/shared";
import {
  ata,
  claimPlatformVaultInstructions,
  collectCpmmCreatorFeeInstructions,
  cpmmAuthority,
  cpmmCreatorFeesPending,
  decodeCpmmPool,
  getMintInfo,
  platformFeeVault,
  poolAddresses,
  sendAndConfirm,
  signatureOf,
  snapshotHolders,
  swapTransaction,
  TOKEN_2022_PROGRAM_ID,
  type MintInfo,
} from "@divvy/solana/live";
import type { WorkerDeps } from "../deps";

export const BURN_OWNERS = ["1nc1nerator11111111111111111111111111111111"];

export type OnSigned = (sig: string) => Promise<void>;
export type Outcome = { status: "landed"; delta: bigint; slot: bigint } | { status: "failed" } | { status: "unknown" };
export type ExcludedRole = "curve" | "pool" | "launcher" | "divvy" | "burn";

export interface SwapQuote {
  outAmount: bigint;
  minOut: bigint;
  priceImpactBps: number;
}

export interface PayoutChain {
  /** Null when the on-chain fee rates and fee wallet match the configuration, else what's wrong. */
  ratesMismatch(): Promise<string | null>;
  /** Lamports waiting in the shared platform fee vault. */
  vaultBalance(): Promise<bigint>;
  /** Sweeps the vault (fee claimer signs). Lamports are the vault's own balance change in the tx. */
  claimVault(onSigned: OnSigned): Promise<{ sig: string; lamports: bigint; slot: bigint } | null>;
  /** What happened to a signed transaction: the token balance change of `account` if it landed. */
  outcome(sig: string, account: "vault" | { assetMint: string }): Promise<Outcome>;
  /** Slot the indexer has processed up to. */
  indexedSlot(): Promise<bigint>;
  mintInfo(mint: string): Promise<MintInfo>;
  quote(assetMint: string, lamportsIn: bigint, slippageBps: number): Promise<SwapQuote>;
  /** Swaps SOL from the fee claimer into the payout vault's ATA. Returns the asset units received. */
  swap(assetMint: string, lamportsIn: bigint, slippageBps: number, onSigned: OnSigned): Promise<{ sig: string; assetOut: bigint }>;
  holders(mint: string): Promise<{ owner: string; amount: bigint }[]>;
  excludedOwners(coin: { mint: string; cpmmPool: string | null }): Map<string, ExcludedRole>;
  /** SOL leg of CPMM creator fees waiting in a graduated coin's pool, when Divvy is the pool creator. */
  cpmmCreatorFees(cpmmPool: string): Promise<bigint>;
  collectCpmmCreatorFees(cpmmPool: string, coinId: string, onSigned: OnSigned): Promise<{ sig: string; lamports: bigint } | null>;
  feeClaimerLamports(): Promise<bigint>;
}

export function tokenDelta(tx: VersionedTransactionResponse, account: PublicKey): bigint {
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
  let index = -1;
  for (let i = 0; i < keys.length; i++) if (keys.get(i)?.equals(account)) index = i;
  if (index < 0) return 0n;
  const amt = (list: TokenBalance[] | null | undefined) => BigInt((list ?? []).find((b) => b.accountIndex === index)?.uiTokenAmount.amount ?? "0");
  return amt(tx.meta?.postTokenBalances) - amt(tx.meta?.preTokenBalances);
}

export function liveChain(d: WorkerDeps): PayoutChain {
  const feeClaimer = () => d.wallets.feeClaimer();
  const payoutVault = () => d.wallets.payoutVault();
  const vault = platformFeeVault(d.programs.launchLab, d.sol.platformConfig);
  const wsol = () => ata(feeClaimer().publicKey, NATIVE_MINT, TOKEN_PROGRAM_ID);

  async function landed(sig: string, purpose: string) {
    for (let i = 0; i < 10; i++) {
      const tx = await d.conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (tx) return tx;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`${purpose}: confirmed but not served by getTransaction yet`);
  }

  async function send(tx: VersionedTransaction, lastValidBlockHeight: number, purpose: string, coinId: string | null, onSigned: OnSigned) {
    tx.sign([feeClaimer()]);
    await onSigned(signatureOf(tx));
    const sig = await sendAndConfirm(d.conn, d.sol, tx, { purpose, signer: "fee_claimer", coinId, lastValidBlockHeight }, d.txlog);
    return landed(sig, purpose);
  }

  async function sendIxs(ixs: TransactionInstruction[], purpose: string, coinId: string | null, onSigned: OnSigned) {
    const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: feeClaimer().publicKey,
      recentBlockhash: blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: d.env.CU_PRICE_MICRO_LAMPORTS }), ...ixs],
    }).compileToV0Message();
    return send(new VersionedTransaction(msg), lastValidBlockHeight, purpose, coinId, onSigned);
  }

  async function payoutAta(mint: string) {
    const info = await getMintInfo(d.conn, new PublicKey(mint));
    return { info, address: ata(payoutVault().publicKey, info.address, info.programId) };
  }

  return {
    async ratesMismatch() {
      const { global, platform } = await d.chain();
      const want = expectedOnChainRates(d.params.fees);
      const got = { tradeFeeRate: Number(global.tradeFeeRate.toString()), platformFeeRate: Number(platform.feeRate.toString()), creatorFeeRate: Number(platform.creatorFeeRate.toString()) };
      const bad = (Object.keys(want) as (keyof typeof want)[]).filter((k) => want[k] !== got[k]);
      if (bad.length) return `on-chain fee rates ${JSON.stringify(got)} don't match the configured split ${JSON.stringify(want)}`;
      if (!platform.platformClaimFeeWallet.equals(feeClaimer().publicKey)) return "PlatformConfig.platform_fee_wallet is not the fee claimer key";
      return null;
    },
    async vaultBalance() {
      const b = await d.conn.getTokenAccountBalance(vault, "confirmed").catch(() => null);
      return BigInt(b?.value.amount ?? "0");
    },
    async claimVault(onSigned) {
      if ((await this.vaultBalance()) === 0n) return null;
      const tx = await sendIxs(claimPlatformVaultInstructions(d.programs.launchLab, d.sol.platformConfig, feeClaimer().publicKey), "fees.claim_platform", null, onSigned);
      return { sig: tx.transaction.signatures[0]!, lamports: -tokenDelta(tx, vault), slot: BigInt(tx.slot) };
    },
    async outcome(sig, account) {
      const st = (await d.conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (!st) return { status: "unknown" };
      if (st.err) return { status: "failed" };
      if (st.confirmationStatus === "processed") return { status: "unknown" };
      const tx = await landed(sig, "outcome");
      const acc = account === "vault" ? vault : (await payoutAta(account.assetMint)).address;
      const delta = tokenDelta(tx, acc);
      return { status: "landed", delta: account === "vault" ? -delta : delta, slot: BigInt(tx.slot) };
    },
    async indexedSlot() {
      const c = await d.prisma.indexerCursor.findUnique({ where: { name: "platform" } });
      return c?.lastSlot ?? 0n;
    },
    mintInfo: (mint) => getMintInfo(d.conn, new PublicKey(mint)),
    async quote(assetMint, lamportsIn, slippageBps) {
      const { address } = await payoutAta(assetMint);
      const b = await d.jupiter.build({ inputMint: NATIVE_MINT.toBase58(), outputMint: assetMint, amount: lamportsIn, taker: feeClaimer().publicKey, slippageBps, destinationTokenAccount: address });
      return { outAmount: b.outAmount, minOut: b.minOut, priceImpactBps: b.priceImpactBps };
    },
    async swap(assetMint, lamportsIn, slippageBps, onSigned) {
      const { info, address } = await payoutAta(assetMint);
      const built = await d.jupiter.build({ inputMint: NATIVE_MINT.toBase58(), outputMint: assetMint, amount: lamportsIn, taker: feeClaimer().publicKey, slippageBps, destinationTokenAccount: address });
      const createDest = createAssociatedTokenAccountIdempotentInstruction(feeClaimer().publicKey, address, payoutVault().publicKey, info.address, info.programId);
      const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
      const vtx = swapTransaction(feeClaimer().publicKey, { ...built, instructions: [createDest, ...built.instructions] }, blockhash);
      const tx = await send(vtx, lastValidBlockHeight, "payout.swap", null, onSigned);
      return { sig: tx.transaction.signatures[0]!, assetOut: tokenDelta(tx, address) };
    },
    holders: (mint) => snapshotHolders(d.conn, new PublicKey(mint), TOKEN_2022_PROGRAM_ID, { das: d.env.HOLDERS_VIA_DAS }),
    excludedOwners(coin) {
      const m = new Map<string, ExcludedRole>();
      // Curve vaults are owned by the LaunchLab authority PDA; CPMM vaults by the CPMM authority PDA.
      const curve = poolAddresses(d.programs.launchLab, new PublicKey(coin.mint));
      m.set(curve.auth.toBase58(), "curve");
      m.set(curve.poolId.toBase58(), "curve");
      m.set(cpmmAuthority(d.programs.cpmm).toBase58(), "pool");
      if (coin.cpmmPool) m.set(coin.cpmmPool, "pool");
      for (const [role, get] of [["launcher", d.wallets.launcher], ["divvy", d.wallets.payoutVault], ["divvy", d.wallets.feeClaimer]] as const) {
        try {
          m.set(get().publicKey.toBase58(), role);
        } catch {
          /* key not configured in this process */
        }
      }
      for (const b of BURN_OWNERS) m.set(b, "burn");
      return m;
    },
    async cpmmCreatorFees(cpmmPool) {
      const info = await d.conn.getAccountInfo(new PublicKey(cpmmPool), "confirmed");
      if (!info) return 0n;
      const pool = decodeCpmmPool(info.data);
      if (!pool.poolCreator.equals(feeClaimer().publicKey)) return 0n;
      const fees = cpmmCreatorFeesPending(pool);
      return pool.mintA.equals(NATIVE_MINT) ? fees.a : pool.mintB.equals(NATIVE_MINT) ? fees.b : 0n;
    },
    async collectCpmmCreatorFees(cpmmPool, coinId, onSigned) {
      const poolId = new PublicKey(cpmmPool);
      const info = await d.conn.getAccountInfo(poolId, "confirmed");
      if (!info) return null;
      const pool = decodeCpmmPool(info.data);
      if (!pool.poolCreator.equals(feeClaimer().publicKey)) return null;
      // Collect without closing the WSOL account so the amount can be read from the tx; unwrap after.
      const ixs = collectCpmmCreatorFeeInstructions(d.programs.cpmm, poolId, pool, feeClaimer().publicKey, false);
      const tx = await sendIxs(ixs, "fees.collect_cpmm_creator", coinId, onSigned);
      const lamports = tokenDelta(tx, wsol());
      await sendIxs([createCloseAccountInstruction(wsol(), feeClaimer().publicKey, feeClaimer().publicKey, [], TOKEN_PROGRAM_ID)], "fees.unwrap_wsol", coinId, async () => {});
      return { sig: tx.transaction.signatures[0]!, lamports };
    },
    async feeClaimerLamports() {
      return BigInt(await d.conn.getBalance(feeClaimer().publicKey, "confirmed"));
    },
  };
}
