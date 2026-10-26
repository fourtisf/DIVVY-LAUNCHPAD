/**
 * Raydium CPMM, where a coin trades after graduation (raydium-cp-swap@f4b9b26, open source).
 *
 * - Pool layout: SDK CpmmPoolInfoLayout (raydium-sdk-V2@b69d02b src/raydium/cpmm/layout.ts).
 * - SwapEvent: `emit!` in swap_base_input.rs:165 / swap_base_output.rs:107, struct in states/events.rs.
 *   emit! writes a "Program data: <base64>" log line, so we only accept it while the CPMM program is
 *   the innermost running program (other programs can print look-alike lines).
 * - collect_creator_fee (instructions/collect_creator_fee.rs): signed by pool_state.pool_creator,
 *   which LaunchLab sets from PlatformConfig.platform_cp_creator (docs/verified/launchlab.md §5c).
 *   The creator is also `mut` (it pays for init_if_needed ATAs), so it must be the fee payer.
 */
import { createHash } from "node:crypto";
import {
  Connection,
  PublicKey,
  type TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { AccountLayout, createCloseAccountInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { CpmmPoolInfoLayout, getCpmmPdaPoolId, getPdaPoolAuthority, makeCollectCreatorFeeInstruction } from "@raydium-io/raydium-sdk-v2";

export type CpmmPool = ReturnType<typeof CpmmPoolInfoLayout.decode>;
export const decodeCpmmPool = (data: Buffer): CpmmPool => CpmmPoolInfoLayout.decode(data);

const disc = (s: string) => createHash("sha256").update(s).digest().subarray(0, 8);
export const CPMM_SWAP_EVENT_DISC = disc("event:SwapEvent");

export interface CpmmSwapEvent {
  poolId: PublicKey;
  inputVaultBefore: bigint;
  outputVaultBefore: bigint;
  inputAmount: bigint;
  outputAmount: bigint;
  inputTransferFee: bigint;
  outputTransferFee: bigint;
  baseInput: boolean;
  inputMint: PublicKey;
  outputMint: PublicKey;
  tradeFee: bigint;
  creatorFee: bigint;
  creatorFeeOnInput: boolean;
}

/** 32 + 6×8 + 1 + 32 + 32 + 8 + 8 + 1 bytes after the discriminator. */
export const CPMM_SWAP_EVENT_LEN = 162;

export function decodeCpmmSwapEvent(body: Buffer): CpmmSwapEvent {
  if (body.length < CPMM_SWAP_EVENT_LEN) throw new Error(`SwapEvent too short: ${body.length}`);
  let o = 0;
  const pk = () => new PublicKey(body.subarray(o, (o += 32)));
  const u64 = () => {
    const v = body.readBigUInt64LE(o);
    o += 8;
    return v;
  };
  const bool = () => body[o++] === 1;
  return {
    poolId: pk(),
    inputVaultBefore: u64(),
    outputVaultBefore: u64(),
    inputAmount: u64(),
    outputAmount: u64(),
    inputTransferFee: u64(),
    outputTransferFee: u64(),
    baseInput: bool(),
    inputMint: pk(),
    outputMint: pk(),
    tradeFee: u64(),
    creatorFee: u64(),
    creatorFeeOnInput: bool(),
  };
}

const INVOKE = /^Program (\w+) invoke \[\d+\]$/;
const DONE = /^Program (\w+) (success|failed)/;

/**
 * SwapEvents from a transaction's logs, keeping only lines printed while the CPMM program was
 * running. `seq` numbers events in log order so (sig, seq) is a stable key.
 */
export function parseCpmmSwaps(tx: VersionedTransactionResponse, cpmm: PublicKey): { seq: number; event: CpmmSwapEvent }[] {
  if (!tx.meta || tx.meta.err) return [];
  const id = cpmm.toBase58();
  const stack: string[] = [];
  const out: { seq: number; event: CpmmSwapEvent }[] = [];
  let seq = 0;
  for (const line of tx.meta.logMessages ?? []) {
    const inv = INVOKE.exec(line);
    if (inv) {
      stack.push(inv[1]!);
      continue;
    }
    if (DONE.test(line)) {
      stack.pop();
      continue;
    }
    if (!line.startsWith("Program data: ") || stack[stack.length - 1] !== id) continue;
    const data = Buffer.from(line.slice("Program data: ".length), "base64");
    if (data.length >= 8 + CPMM_SWAP_EVENT_LEN && data.subarray(0, 8).equals(CPMM_SWAP_EVENT_DISC)) {
      out.push({ seq: seq++, event: decodeCpmmSwapEvent(data.subarray(8)) });
    }
  }
  return out;
}

/**
 * The CPMM pool PDA [pool, amm_config, token_0, token_1] with the mints in byte order
 * (cp-swap initialize_with_permission.rs). A migration may also use a non-PDA pool account, so
 * callers confirm the account exists and prefer the address seen in the migration transaction.
 */
export function cpmmPoolPda(programId: PublicKey, ammConfig: PublicKey, mintX: PublicKey, mintY: PublicKey): PublicKey {
  const [a, b] = [mintX, mintY].sort((x, y) => Buffer.compare(x.toBuffer(), y.toBuffer()));
  return getCpmmPdaPoolId(programId, ammConfig, a!, b!).publicKey;
}

/** Solana cuts long log output with "Log truncated"; swaps logged after that point can't be read. */
export const logsTruncated = (tx: VersionedTransactionResponse): boolean => !!tx.meta?.logMessages?.some((l) => l.startsWith("Log truncated"));

/** Tradeable reserves: vault balances minus the fees parked in them (cp-swap PoolState::vault_amount_without_fee). */
export async function cpmmReserves(conn: Connection, pool: CpmmPool): Promise<{ a: bigint; b: bigint }> {
  const [va, vb] = await conn.getMultipleAccountsInfo([pool.vaultA, pool.vaultB]);
  if (!va || !vb) throw new Error("CPMM vaults not found");
  const bal = (d: Buffer) => AccountLayout.decode(d.subarray(0, 165)).amount;
  const big = (x: { toString(): string }) => BigInt(x.toString());
  const a = bal(va.data) - big(pool.protocolFeesMintA) - big(pool.fundFeesMintA) - big(pool.creatorFeesMintA);
  const b = bal(vb.data) - big(pool.protocolFeesMintB) - big(pool.fundFeesMintB) - big(pool.creatorFeesMintB);
  return { a: a < 0n ? 0n : a, b: b < 0n ? 0n : b };
}

/** SOL per whole coin from CPMM reserves. */
export function cpmmPriceSol(pool: CpmmPool, reserves: { a: bigint; b: bigint }, coinMint: PublicKey): number {
  const coinIsA = pool.mintA.equals(coinMint);
  const coin = coinIsA ? reserves.a : reserves.b;
  const sol = coinIsA ? reserves.b : reserves.a;
  const coinDec = coinIsA ? pool.mintDecimalA : pool.mintDecimalB;
  if (coin === 0n) return 0;
  return Number(sol) / 1e9 / (Number(coin) / 10 ** coinDec);
}

/** Creator fees waiting in the pool, per side. */
export const cpmmCreatorFeesPending = (pool: CpmmPool) => ({ a: BigInt(pool.creatorFeesMintA.toString()), b: BigInt(pool.creatorFeesMintB.toString()) });

/** The CPMM vault and LP-mint authority PDA, owner of every CPMM pool vault. */
export const cpmmAuthority = (programId: PublicKey): PublicKey => getPdaPoolAuthority(programId).publicKey;

/**
 * collect_creator_fee into `creator`'s ATAs (created by the program if needed), then, unless
 * `closeWsol` is false, closes the WSOL ATA so the SOL leg lands as plain lamports. `creator` must
 * sign and pay.
 */
export function collectCpmmCreatorFeeInstructions(programId: PublicKey, poolId: PublicKey, pool: CpmmPool, creator: PublicKey, closeWsol = true): TransactionInstruction[] {
  const ownerA = getAssociatedTokenAddressSync(pool.mintA, creator, false, pool.mintProgramA);
  const ownerB = getAssociatedTokenAddressSync(pool.mintB, creator, false, pool.mintProgramB);
  const ixs = [
    makeCollectCreatorFeeInstruction(
      programId, creator, getPdaPoolAuthority(programId).publicKey, poolId, pool.configId,
      pool.vaultA, pool.vaultB, pool.mintA, pool.mintB, ownerA, ownerB, pool.mintProgramA, pool.mintProgramB,
    ),
  ];
  if (!closeWsol) return ixs;
  if (pool.mintA.equals(NATIVE_MINT)) ixs.push(createCloseAccountInstruction(ownerA, creator, creator, [], TOKEN_PROGRAM_ID));
  if (pool.mintB.equals(NATIVE_MINT)) ixs.push(createCloseAccountInstruction(ownerB, creator, creator, [], TOKEN_PROGRAM_ID));
  return ixs;
}
