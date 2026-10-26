/**
 * After graduation: the locked LP (Raydium Burn & Earn) and selling the memecoin part of its fees.
 *
 * - At migration LaunchLab locks the platform's LP share and mints one Fee Key NFT to
 *   PlatformConfig.platform_lock_nft_wallet (docs/verified/launchlab.md §5a). Divvy sets that wallet
 *   to the fee claimer.
 * - collect_cp_fee (raydium-sdk-V2@b69d02b src/raydium/cpmm/cpmm.ts:910-1024 harvestLockLp,
 *   instruction.ts:476-550): signed by the Fee Key's owner; the lock record is the PDA
 *   ["locked_liquidity", nftMint] under the lock program (pda.ts:121-131).
 * - The lock program is closed source. How much LP fee can be collected comes from Raydium's API,
 *   GET {dynamic-ipfs}/lock/cpmm/position?id=<lock PDA>, field positionInfo.unclaimedFee.lp
 *   (raydium-docs-v1@3682384 api-reference/openapi/dynamic-ipfs-v1.yaml). Its unit isn't
 *   documented, so `lpFeeCandidates` tries both readings and the worker simulates before signing.
 * - Fees arrive in SOL and in the memecoin (sells pay their fee in the coin). The memecoin is sold
 *   back into the coin's own CPMM pool with swap_base_input (instruction.ts:224-270).
 */
import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { AccountLayout, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { z } from "zod";
import {
  collectCpFeeInstruction,
  CpmmConfigInfoLayout,
  getCpLockPda,
  getPdaPoolAuthority,
  makeSwapCpmmBaseInInstruction,
} from "@raydium-io/raydium-sdk-v2";
import type { CpmmPool } from "./cpmm";
import { ata } from "./tokens";

const DYNAMIC_IPFS = { "mainnet-beta": "https://dynamic-ipfs.raydium.io", devnet: "https://dynamic-ipfs-devnet.raydium.io" } as const;

export const lockedLiquidityPda = (lockProgram: PublicKey, nftMint: PublicKey): PublicKey => getCpLockPda(lockProgram, nftMint).publicKey;

/** Where the lock program keeps every locked LP token of a pool (harvestLockLp, cpmm.ts:981). */
export const lockLpVault = (lockAuth: PublicKey, lpMint: PublicKey): PublicKey => ata(lockAuth, lpMint, TOKEN_PROGRAM_ID);

export interface FeeKey {
  nftMint: PublicKey;
  lock: PublicKey;
  /** Raw lock record. Closed layout; only searched for the pool's address. */
  data: Buffer;
}

/**
 * Fee Keys held by `owner`: SPL Token accounts holding exactly one token whose lock record exists
 * under the lock program (the same test as the SDK's fetchCpmmLockBalances, cpmm.ts:1723-1750).
 */
export async function findFeeKeys(conn: Connection, lockProgram: PublicKey, owner: PublicKey): Promise<FeeKey[]> {
  const accounts = await conn.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed");
  const mints = accounts.value.map((a) => AccountLayout.decode(a.account.data)).filter((t) => t.amount === 1n).map((t) => t.mint);
  const out: FeeKey[] = [];
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    const locks = chunk.map((m) => lockedLiquidityPda(lockProgram, m));
    const infos = await conn.getMultipleAccountsInfo(locks, "confirmed");
    infos.forEach((info, j) => {
      if (info && info.owner.equals(lockProgram)) out.push({ nftMint: chunk[j]!, lock: locks[j]!, data: info.data });
    });
  }
  return out;
}

/** Whether a lock record names this pool. Cross-checked against Raydium's API before any harvest. */
export const lockNamesPool = (data: Buffer, pool: PublicKey): boolean => data.indexOf(pool.toBuffer()) >= 0;

const LockPositionSchema = z.object({
  poolInfo: z.object({ id: z.string() }),
  positionInfo: z.object({ unclaimedFee: z.object({ lp: z.number() }) }),
});

/** Raydium's view of a locked position: its pool and the LP fee it says can be collected. */
export async function fetchLockedPosition(cluster: keyof typeof DYNAMIC_IPFS, lock: PublicKey, fetchImpl: typeof fetch = fetch): Promise<{ poolId: string; lp: number }> {
  const r = await fetchImpl(`${DYNAMIC_IPFS[cluster]}/lock/cpmm/position?id=${lock.toBase58()}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Raydium lock API answered ${r.status} for ${lock.toBase58()}`);
  const p = LockPositionSchema.parse(await r.json());
  return { poolId: p.poolInfo.id, lp: p.positionInfo.unclaimedFee.lp };
}

/**
 * Raw LP amounts to try for the API's claimable figure, largest first: the figure read as whole LP
 * tokens, then (if it is a whole number) as base units. Anything above `maxLp` is dropped: one
 * hour's fees are a small part of the locked LP, so a bigger reading means the unit is wrong.
 */
export function lpFeeCandidates(lp: number, lpDecimals: number, maxLp: bigint): bigint[] {
  if (!Number.isFinite(lp) || lp <= 0) return [];
  const out = new Set<bigint>();
  out.add(BigInt(Math.floor(lp * 10 ** lpDecimals)));
  if (Number.isInteger(lp)) out.add(BigInt(lp));
  return [...out].filter((v) => v > 0n && v <= maxLp).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

/** collect_cp_fee into `owner`'s ATAs for both pool mints (they must exist; see harvestLockLp). */
export function collectLockedLpFeeInstruction(p: {
  lockProgram: PublicKey;
  lockAuth: PublicKey;
  cpmmProgram: PublicKey;
  owner: PublicKey;
  nftMint: PublicKey;
  poolId: PublicKey;
  pool: CpmmPool;
  lpFeeAmount: bigint;
}): TransactionInstruction {
  return collectCpFeeInstruction({
    programId: p.lockProgram,
    nftOwner: p.owner,
    auth: p.lockAuth,
    nftMint: p.nftMint,
    nftAccount: ata(p.owner, p.nftMint, TOKEN_PROGRAM_ID),
    lockPda: lockedLiquidityPda(p.lockProgram, p.nftMint),
    poolId: p.poolId,
    mintLp: p.pool.mintLp,
    userVaultA: ata(p.owner, p.pool.mintA, p.pool.mintProgramA),
    userVaultB: ata(p.owner, p.pool.mintB, p.pool.mintProgramB),
    poolVaultA: p.pool.vaultA,
    poolVaultB: p.pool.vaultB,
    mintA: p.pool.mintA,
    mintB: p.pool.mintB,
    lockLpVault: lockLpVault(p.lockAuth, p.pool.mintLp),
    lpFeeAmount: new BN(p.lpFeeAmount.toString()),
    cpmmProgram: p.cpmmProgram,
    cpmmAuthProgram: getPdaPoolAuthority(p.cpmmProgram).publicKey,
  });
}

export type CpmmConfig = ReturnType<typeof CpmmConfigInfoLayout.decode>;
export const decodeCpmmConfig = (data: Buffer): CpmmConfig => CpmmConfigInfoLayout.decode(data);

/**
 * Output of selling `amountIn` of the coin for SOL against `reserves`, after the pool's trade fee
 * and (when the pool charges it) the creator fee. Constant product, floored.
 */
export function cpmmSellQuote(amountIn: bigint, coinReserve: bigint, solReserve: bigint, tradeFeeRate: bigint, creatorFeeRate: bigint): bigint {
  const net = (amountIn * (1_000_000n - tradeFeeRate - creatorFeeRate)) / 1_000_000n;
  if (net <= 0n || coinReserve + net === 0n) return 0n;
  return (solReserve * net) / (coinReserve + net);
}

/** swap_base_input selling the coin for WSOL into `owner`'s WSOL ATA (which must exist). */
export function cpmmSellInstruction(p: { cpmmProgram: PublicKey; owner: PublicKey; poolId: PublicKey; pool: CpmmPool; coinMint: PublicKey; amountIn: bigint; minOut: bigint }): TransactionInstruction {
  const coinIsA = p.pool.mintA.equals(p.coinMint);
  const coinProgram = coinIsA ? p.pool.mintProgramA : p.pool.mintProgramB;
  return makeSwapCpmmBaseInInstruction(
    p.cpmmProgram,
    p.owner,
    getPdaPoolAuthority(p.cpmmProgram).publicKey,
    p.pool.configId,
    p.poolId,
    ata(p.owner, p.coinMint, coinProgram),
    ata(p.owner, NATIVE_MINT, TOKEN_PROGRAM_ID),
    coinIsA ? p.pool.vaultA : p.pool.vaultB,
    coinIsA ? p.pool.vaultB : p.pool.vaultA,
    coinProgram,
    TOKEN_PROGRAM_ID,
    p.coinMint,
    NATIVE_MINT,
    p.pool.observationId,
    new BN(p.amountIn.toString()),
    new BN(p.minOut.toString()),
  );
}
