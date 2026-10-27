/** Token helpers for Divvy coins (Token-2022) and xStocks (Token-2022 with pausable/hook extensions). */
import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  ExtensionType,
  getAccountLen,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getPausableConfig,
  getScaledUiAmountConfig,
  getTransferHook,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
  type Mint,
} from "@solana/spl-token";

export interface MintInfo {
  address: PublicKey;
  programId: PublicKey;
  decimals: number;
  paused: boolean;
  /** Transfer hook program, if one is set (xStocks ship it initialized but disabled). */
  transferHookProgram: PublicKey | null;
  scaledUiMultiplier: number | null;
  mint: Mint;
}

export async function getMintInfo(conn: Connection, address: PublicKey): Promise<MintInfo> {
  const acc = await conn.getAccountInfo(address);
  if (!acc) throw new Error(`mint ${address.toBase58()} not found`);
  const programId = acc.owner;
  if (!programId.equals(TOKEN_PROGRAM_ID) && !programId.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("not a token mint");
  const mint = unpackMint(address, acc, programId);
  const pausable = programId.equals(TOKEN_2022_PROGRAM_ID) ? getPausableConfig(mint) : null;
  const hook = programId.equals(TOKEN_2022_PROGRAM_ID) ? getTransferHook(mint) : null;
  const scaled = programId.equals(TOKEN_2022_PROGRAM_ID) ? getScaledUiAmountConfig(mint) : null;
  const hookProgram = hook && !hook.programId.equals(PublicKey.default) ? hook.programId : null;
  return {
    address,
    programId,
    decimals: mint.decimals,
    paused: !!pausable?.paused,
    transferHookProgram: hookProgram,
    scaledUiMultiplier: scaled ? Number(scaled.multiplier) : null,
    mint,
  };
}

export const ata = (owner: PublicKey, mint: PublicKey, programId: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, programId);

/**
 * The account extensions token-2022 requires when an account of a mint with these extensions is
 * initialized: token-2022@f0a7d60 interface/src/extension/mod.rs:1296-1309
 * (required_init_account_extensions). spl-token's getAccountTypeOfMintType is broader (it also maps
 * ConfidentialTransferMint, which xStocks carry, to a 295-byte account extension the program never
 * adds), so it would overstate the rent.
 */
const REQUIRED_ACCOUNT_EXTENSIONS: Partial<Record<ExtensionType, ExtensionType[]>> = {
  [ExtensionType.TransferFeeConfig]: [ExtensionType.TransferFeeAmount],
  [ExtensionType.NonTransferable]: [ExtensionType.NonTransferableAccount, ExtensionType.ImmutableOwner],
  [ExtensionType.TransferHook]: [ExtensionType.TransferHookAccount],
  [ExtensionType.PausableConfig]: [ExtensionType.PausableAccount],
};

/**
 * Size of a new associated token account for this mint, which sets its rent: for Token-2022, the
 * account extensions the mint requires plus ImmutableOwner, which the ATA program always asks for.
 */
export function newAtaLen(info: Pick<MintInfo, "programId" | "mint">): number {
  if (!info.programId.equals(TOKEN_2022_PROGRAM_ID)) return getAccountLen([]);
  const required = getExtensionTypes(info.mint.tlvData).flatMap((e) => REQUIRED_ACCOUNT_EXTENSIONS[e] ?? []);
  return getAccountLen([...new Set([...required, ExtensionType.ImmutableOwner])]);
}

/**
 * transferChecked from `from` (owner `authority`) to `to`'s ATA, creating the ATA first when
 * `createAta` is set (the payer funds its rent). Plain Transfer fails on pausable / hook accounts
 * (token-2022 processor.rs:440-462), so this is always transferChecked.
 */
export function transferIxs(p: {
  mint: MintInfo;
  authority: PublicKey;
  to: PublicKey;
  amount: bigint;
  payer: PublicKey;
  createAta: boolean;
}): TransactionInstruction[] {
  if (p.mint.transferHookProgram) throw new Error("transfer hook is enabled on this mint; extra accounts are required (not supported yet)");
  const source = ata(p.authority, p.mint.address, p.mint.programId);
  const dest = ata(p.to, p.mint.address, p.mint.programId);
  const ixs: TransactionInstruction[] = [];
  if (p.createAta) ixs.push(createAssociatedTokenAccountIdempotentInstruction(p.payer, dest, p.to, p.mint.address, p.mint.programId, ASSOCIATED_TOKEN_PROGRAM_ID));
  ixs.push(createTransferCheckedInstruction(source, p.mint.address, dest, p.authority, p.amount, p.mint.decimals, [], p.mint.programId));
  return ixs;
}

/** Which of `owners` already have an ATA for `mint` (no rent needed to send to them). */
export async function existingAtas(conn: Connection, owners: PublicKey[], mint: MintInfo): Promise<Set<string>> {
  const have = new Set<string>();
  for (let i = 0; i < owners.length; i += 100) {
    const chunk = owners.slice(i, i + 100);
    const infos = await conn.getMultipleAccountsInfo(chunk.map((o) => ata(o, mint.address, mint.programId)));
    infos.forEach((info, j) => info && have.add(chunk[j]!.toBase58()));
  }
  return have;
}
