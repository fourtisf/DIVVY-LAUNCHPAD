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
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TokenBalance,
  type TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { AccountLayout, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expectedOnChainRates } from "@divvy/shared";
import {
  assertCanSend,
  ata,
  claimPlatformVaultInstructions,
  collectCpmmCreatorFeeInstructions,
  collectLockedLpFeeInstruction,
  cpmmAuthority,
  cpmmCreatorFeesPending,
  cpmmReserves,
  cpmmSellInstruction,
  cpmmSellQuote,
  decodeCpmmConfig,
  decodeCpmmPool,
  fetchLockedPosition,
  findFeeKeys,
  lockedLiquidityPda,
  lockLpVault,
  lockNamesPool,
  lpFeeCandidates,
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
import { checkSwapInstructions, SwapRejected } from "./swapguard";

export const BURN_OWNERS = ["1nc1nerator11111111111111111111111111111111"];

export type OnSigned = (sig: string) => Promise<void>;
export type Outcome = { status: "landed"; delta: bigint; slot: bigint } | { status: "failed" } | { status: "unknown" };
export type ExcludedRole = "curve" | "pool" | "launcher" | "divvy" | "burn";

export interface SwapGuard {
  /** Refuse if Jupiter's minimum output is below this (reference price minus the impact cap). */
  minOutFloor: bigint;
  maxImpactBps: number;
}

/** What collecting a coin's locked-LP fees gave (or, simulated, would give). */
export interface LockedLpHarvest {
  /** Null when only simulated. */
  sig: string | null;
  lpFeeAmount: bigint;
  /** SOL leg, lamports. */
  lamports: bigint;
  /** Memecoin leg, base units; sold separately. */
  memecoin: bigint;
}

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
  outcome(sig: string, account: "vault" | "wsol" | { assetMint: string }): Promise<Outcome>;
  /** Slot the indexer has processed up to. */
  indexedSlot(): Promise<bigint>;
  finalizedSlot(): Promise<bigint>;
  /** Per signature: finalized, pending (not finalized yet), failed, or missing (not found). */
  signatureStatuses(sigs: string[]): Promise<("finalized" | "pending" | "failed" | "missing")[]>;
  mintInfo(mint: string): Promise<MintInfo>;
  quote(assetMint: string, lamportsIn: bigint, slippageBps: number): Promise<SwapQuote>;
  /**
   * Swaps SOL from the fee claimer into the payout vault's ATA, after checking the built transaction
   * against `guard` and simulating it. Returns the asset units received.
   */
  swap(assetMint: string, lamportsIn: bigint, slippageBps: number, guard: SwapGuard, onSigned: OnSigned): Promise<{ sig: string; assetOut: bigint }>;
  holders(mint: string): Promise<{ owner: string; amount: bigint }[]>;
  excludedOwners(coin: { mint: string; cpmmPool: string | null }): Map<string, ExcludedRole>;
  /** SOL leg of CPMM creator fees waiting in a graduated coin's pool, when Divvy is the pool creator. */
  cpmmCreatorFees(cpmmPool: string): Promise<bigint>;
  collectCpmmCreatorFees(cpmmPool: string, coinId: string, onSigned: OnSigned): Promise<{ sig: string; lamports: bigint } | null>;
  /** CPMM pool → Fee Key mint, for the Fee Keys the fee claimer holds whose lock record names one of `pools`. */
  feeKeysByPool(pools: string[]): Promise<Map<string, string>>;
  /**
   * Collects a graduated coin's locked-LP fees with the Fee Key. Every amount is simulated first;
   * `simulateOnly` never signs. Null when there's nothing to collect or no reading of Raydium's
   * figure simulates cleanly (an alert says which).
   */
  harvestLockedLp(c: { id: string; ticker: string; mint: string; cpmmPool: string; feeKeyMint: string }, simulateOnly: boolean, onSigned: OnSigned): Promise<LockedLpHarvest | null>;
  /** Memecoin base units the fee claimer holds. */
  memecoinBalance(mint: string): Promise<bigint>;
  /**
   * Sells memecoin from the fee claimer into the coin's own CPMM pool for SOL, at most 1% of the
   * pool's coin reserve per call, with a minimum out from the reserves minus SWAP_SLIPPAGE_BPS.
   */
  sellMemecoin(c: { id: string; mint: string; cpmmPool: string }, amount: bigint, onSigned: OnSigned): Promise<{ sig: string; sold: bigint; lamports: bigint } | null>;
  /** Plain SOL transfer from the fee claimer. */
  sendSol(to: string, lamports: bigint, purpose: string, coinId: string, onSigned: OnSigned): Promise<{ sig: string }>;
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
      // An RPC error must not read as "empty" (audit): only a vault that doesn't exist yet is 0.
      const info = await d.conn.getAccountInfo(vault, "confirmed");
      return info ? AccountLayout.decode(info.data.subarray(0, 165)).amount : 0n;
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
      const acc = account === "vault" ? vault : account === "wsol" ? wsol() : (await payoutAta(account.assetMint)).address;
      const delta = tokenDelta(tx, acc);
      return { status: "landed", delta: account === "vault" ? -delta : delta, slot: BigInt(tx.slot) };
    },
    async indexedSlot() {
      const c = await d.prisma.indexerCursor.findUnique({ where: { name: "platform" } });
      return c?.lastSlot ?? 0n;
    },
    async finalizedSlot() {
      return BigInt(await d.conn.getSlot("finalized"));
    },
    async signatureStatuses(sigs) {
      const r = await d.conn.getSignatureStatuses(sigs, { searchTransactionHistory: true });
      return r.value.map((st) => (!st ? "missing" : st.err ? "failed" : st.confirmationStatus === "finalized" ? "finalized" : "pending"));
    },
    mintInfo: (mint) => getMintInfo(d.conn, new PublicKey(mint)),
    async quote(assetMint, lamportsIn, slippageBps) {
      const { address } = await payoutAta(assetMint);
      const b = await d.jupiter.build({ inputMint: NATIVE_MINT.toBase58(), outputMint: assetMint, amount: lamportsIn, taker: feeClaimer().publicKey, slippageBps, destinationTokenAccount: address });
      return { outAmount: b.outAmount, minOut: b.minOut, priceImpactBps: b.priceImpactBps };
    },
    async swap(assetMint, lamportsIn, slippageBps, guard, onSigned) {
      const payer = feeClaimer();
      const { info, address } = await payoutAta(assetMint);
      const useJito = d.sol.cluster === "mainnet-beta";
      const built = await d.jupiter.build({
        inputMint: NATIVE_MINT.toBase58(),
        outputMint: assetMint,
        amount: lamportsIn,
        taker: payer.publicKey,
        slippageBps,
        destinationTokenAccount: address,
        forJitoBundle: useJito,
      });
      // The transaction that gets signed is checked, not an earlier quote (audit).
      if (built.inputMint !== NATIVE_MINT.toBase58() || built.outputMint !== assetMint) throw new SwapRejected("Jupiter built a swap for other mints");
      if (built.inAmount !== lamportsIn) throw new SwapRejected(`Jupiter built a swap of ${built.inAmount} lamports, not ${lamportsIn}`);
      if (built.priceImpactBps > guard.maxImpactBps) throw new SwapRejected(`price impact ${built.priceImpactBps} bps`);
      if (built.minOut < guard.minOutFloor) throw new SwapRejected(`minimum output ${built.minOut} is below the reference floor ${guard.minOutFloor}`);
      checkSwapInstructions(built.instructions, { payer: payer.publicKey, payerWsolAta: wsol(), ataOwners: [payer.publicKey, payoutVault().publicKey] });

      const extra: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, address, payoutVault().publicKey, info.address, info.programId)];
      const tip = useJito ? await d.jito.randomTipAccount() : null;
      if (tip) extra.push(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: tip, lamports: d.sol.jitoTipLamports }));
      const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
      const vtx = swapTransaction(payer.publicKey, { ...built, instructions: [extra[0]!, ...built.instructions, ...extra.slice(1)] }, blockhash);

      // Simulate: the payer may spend at most the swap amount plus fees, rent and tip, and the payout
      // vault must receive at least Jupiter's minimum.
      const before = await d.conn.getMultipleAccountsInfo([payer.publicKey, address], "confirmed");
      const sim = await d.conn.simulateTransaction(vtx, { sigVerify: false, commitment: "confirmed", accounts: { encoding: "base64", addresses: [payer.publicKey.toBase58(), address.toBase58()] } });
      if (sim.value.err) throw new SwapRejected(`simulation failed: ${JSON.stringify(sim.value.err)}`);
      const [payerAfter, destAfter] = sim.value.accounts ?? [];
      const spent = BigInt(before[0]?.lamports ?? 0) - BigInt(payerAfter?.lamports ?? 0);
      const maxSpend = lamportsIn + 30_000_000n + BigInt(tip ? d.sol.jitoTipLamports : 0);
      if (spent > maxSpend) throw new SwapRejected(`simulation spends ${spent} lamports, more than ${maxSpend}`);
      const destBefore = before[1] ? AccountLayout.decode(before[1].data.subarray(0, 165)).amount : 0n;
      const destAfterAmt = destAfter ? AccountLayout.decode(Buffer.from(destAfter.data[0] ?? "", "base64").subarray(0, 165)).amount : 0n;
      if (destAfterAmt - destBefore < built.minOut) throw new SwapRejected(`simulation delivers ${destAfterAmt - destBefore}, less than the minimum ${built.minOut}`);

      vtx.sign([payer]);
      const sig = signatureOf(vtx);
      await onSigned(sig);
      if (useJito) {
        // Public RPC sends can be sandwiched; a bundle can't be split (jito-docs lowlatencytxnsend.md).
        assertCanSend(d.sol, "payout.swap");
        await d.txlog({ purpose: "payout.swap", signer: "fee_claimer", signature: sig });
        const bundleId = await d.jito.sendBundle([Buffer.from(vtx.serialize()).toString("base64")]);
        await d.jito.waitForBundle(bundleId, 60_000);
        // Whatever Jito says, the chain decides: an unknown outcome stays "sent" for the next run.
        const tx = await landed(sig, "payout.swap");
        if (tx.meta?.err) throw new Error(`payout.swap failed on chain: ${JSON.stringify(tx.meta.err)}`);
        return { sig, assetOut: tokenDelta(tx, address) };
      }
      await sendAndConfirm(d.conn, d.sol, vtx, { purpose: "payout.swap", signer: "fee_claimer", lastValidBlockHeight }, d.txlog);
      const tx = await landed(sig, "payout.swap");
      return { sig, assetOut: tokenDelta(tx, address) };
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
    async feeKeysByPool(pools) {
      const keys = await findFeeKeys(d.conn, d.programs.lpLock, feeClaimer().publicKey);
      const out = new Map<string, string>();
      for (const pool of pools) {
        const hit = keys.find((k) => lockNamesPool(k.data, new PublicKey(pool)));
        if (hit) out.set(pool, hit.nftMint.toBase58());
      }
      return out;
    },
    async harvestLockedLp(c, simulateOnly, onSigned) {
      const owner = feeClaimer().publicKey;
      const poolId = new PublicKey(c.cpmmPool);
      const nftMint = new PublicKey(c.feeKeyMint);
      const info = await d.conn.getAccountInfo(poolId, "confirmed");
      if (!info) return null;
      const pool = decodeCpmmPool(info.data);
      const lock = lockedLiquidityPda(d.programs.lpLock, nftMint);
      // Raydium's API must agree that this lock belongs to this coin's pool.
      const pos = await fetchLockedPosition(d.sol.cluster, lock, fetch);
      if (pos.poolId !== c.cpmmPool) {
        await d.alerts.send(`lplock-pool-${c.id}`, "critical", `${c.ticker}: Raydium says Fee Key ${c.feeKeyMint} locks pool ${pos.poolId}, not ${c.cpmmPool}. Not harvesting.`, 86_400);
        return null;
      }
      const lockedInfo = await d.conn.getAccountInfo(lockLpVault(d.programs.lpLockAuth, pool.mintLp), "confirmed");
      const locked = lockedInfo ? AccountLayout.decode(lockedInfo.data.subarray(0, 165)).amount : 0n;
      // One hour's fees are a small part of the locked LP; anything above a tenth means a misread figure.
      const candidates = lpFeeCandidates(pos.lp, pool.lpDecimals, locked / 10n);
      if (!candidates.length) return null;

      const coinMint = new PublicKey(c.mint);
      const coinProgram = pool.mintA.equals(coinMint) ? pool.mintProgramA : pool.mintProgramB;
      const coinAta = ata(owner, coinMint, coinProgram);
      const setup = [
        createAssociatedTokenAccountIdempotentInstruction(owner, wsol(), owner, NATIVE_MINT, TOKEN_PROGRAM_ID),
        createAssociatedTokenAccountIdempotentInstruction(owner, coinAta, owner, coinMint, coinProgram),
      ];
      const ixsFor = (lpFeeAmount: bigint) => [
        ...setup,
        collectLockedLpFeeInstruction({ lockProgram: d.programs.lpLock, lockAuth: d.programs.lpLockAuth, cpmmProgram: d.programs.cpmm, owner, nftMint, poolId, pool, lpFeeAmount }),
      ];
      const balance = (acc: { data: Buffer | string[] } | null | undefined) =>
        !acc ? 0n : AccountLayout.decode((Array.isArray(acc.data) ? Buffer.from(acc.data[0] ?? "", "base64") : acc.data).subarray(0, 165)).amount;

      for (const lpFeeAmount of candidates) {
        const { blockhash } = await d.conn.getLatestBlockhash("confirmed");
        const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixsFor(lpFeeAmount) }).compileToV0Message();
        const before = await d.conn.getMultipleAccountsInfo([wsol(), coinAta], "confirmed");
        const sim = await d.conn.simulateTransaction(new VersionedTransaction(msg), {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
          accounts: { encoding: "base64", addresses: [wsol().toBase58(), coinAta.toBase58()] },
        });
        if (sim.value.err) continue;
        const [w, m] = sim.value.accounts ?? [];
        const lamports = balance(w) - balance(before[0]);
        const memecoin = balance(m) - balance(before[1]);
        if (lamports < 0n || memecoin < 0n || lamports + memecoin === 0n) continue;
        if (simulateOnly) return { sig: null, lpFeeAmount, lamports, memecoin };

        const tx = await sendIxs(ixsFor(lpFeeAmount), "fees.collect_locked_lp", c.id, onSigned);
        const got = { lamports: tokenDelta(tx, wsol()), memecoin: tokenDelta(tx, coinAta) };
        await sendIxs([createCloseAccountInstruction(wsol(), owner, owner, [], TOKEN_PROGRAM_ID)], "fees.unwrap_wsol", c.id, async () => {});
        return { sig: tx.transaction.signatures[0]!, lpFeeAmount, ...got };
      }
      await d.alerts.send(`lplock-sim-${c.id}`, "warn", `${c.ticker}: no reading of Raydium's claimable LP fee (${pos.lp}) simulates cleanly; locked-LP fees wait`, 86_400);
      return null;
    },
    async memecoinBalance(mint) {
      const info = await getMintInfo(d.conn, new PublicKey(mint));
      const acc = await d.conn.getAccountInfo(ata(feeClaimer().publicKey, info.address, info.programId), "confirmed");
      return acc ? AccountLayout.decode(acc.data.subarray(0, 165)).amount : 0n;
    },
    async sellMemecoin(c, amount, onSigned) {
      const owner = feeClaimer().publicKey;
      const poolId = new PublicKey(c.cpmmPool);
      const coinMint = new PublicKey(c.mint);
      const info = await d.conn.getAccountInfo(poolId, "confirmed");
      if (!info) return null;
      const pool = decodeCpmmPool(info.data);
      const cfgInfo = await d.conn.getAccountInfo(pool.configId, "confirmed");
      if (!cfgInfo) return null;
      const cfg = decodeCpmmConfig(cfgInfo.data);
      const reserves = await cpmmReserves(d.conn, pool);
      const coinIsA = pool.mintA.equals(coinMint);
      const coinReserve = coinIsA ? reserves.a : reserves.b;
      const solReserve = coinIsA ? reserves.b : reserves.a;
      const sold = amount < coinReserve / 100n ? amount : coinReserve / 100n;
      const creatorRate = pool.enableCreatorFee ? BigInt(cfg.creatorFeeRate.toString()) : 0n;
      const expected = cpmmSellQuote(sold, coinReserve, solReserve, BigInt(cfg.tradeFeeRate.toString()), creatorRate);
      const minOut = (expected * BigInt(10_000 - d.params.swapSlippageBps)) / 10_000n;
      if (minOut < 10_000n) return null; // not worth a transaction
      const ixs = [
        createAssociatedTokenAccountIdempotentInstruction(owner, wsol(), owner, NATIVE_MINT, TOKEN_PROGRAM_ID),
        cpmmSellInstruction({ cpmmProgram: d.programs.cpmm, owner, poolId, pool, coinMint, amountIn: sold, minOut }),
      ];
      const tx = await sendIxs(ixs, "fees.sell_memecoin", c.id, onSigned);
      const lamports = tokenDelta(tx, wsol());
      await sendIxs([createCloseAccountInstruction(wsol(), owner, owner, [], TOKEN_PROGRAM_ID)], "fees.unwrap_wsol", c.id, async () => {});
      return { sig: tx.transaction.signatures[0]!, sold, lamports };
    },
    async sendSol(to, lamports, purpose, coinId, onSigned) {
      const tx = await sendIxs([SystemProgram.transfer({ fromPubkey: feeClaimer().publicKey, toPubkey: new PublicKey(to), lamports })], purpose, coinId, onSigned);
      return { sig: tx.transaction.signatures[0]! };
    },
    async feeClaimerLamports() {
      return BigInt(await d.conn.getBalance(feeClaimer().publicKey, "confirmed"));
    },
  };
}
