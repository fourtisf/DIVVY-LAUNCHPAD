import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ExtensionType, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, type Mint } from "@solana/spl-token";
import {
  ata,
  collectLockedLpFeeInstruction,
  cpmmSellInstruction,
  cpmmSellQuote,
  fetchLockedPosition,
  lockedLiquidityPda,
  lockNamesPool,
  lpFeeCandidates,
  newAtaLen,
  programs,
  type CpmmPool,
} from "../src/live";

const pk = () => Keypair.generate().publicKey;
const p = programs("mainnet-beta");

describe("lpFeeCandidates", () => {
  const max = 1_000_000_000_000n; // 1,000 LP at 9 decimals

  it("reads a fractional figure as whole LP tokens", () => {
    expect(lpFeeCandidates(0.25, 9, max)).toEqual([250_000_000n]);
  });

  it("tries both readings of a whole number, the larger first", () => {
    expect(lpFeeCandidates(3, 9, max)).toEqual([3_000_000_000n, 3n]);
  });

  it("drops readings above the cap, so a base-unit figure isn't scaled up", () => {
    expect(lpFeeCandidates(5_000_000, 9, max)).toEqual([5_000_000n]);
  });

  it("returns nothing for zero, negative or non-finite figures", () => {
    expect(lpFeeCandidates(0, 9, max)).toEqual([]);
    expect(lpFeeCandidates(-1, 9, max)).toEqual([]);
    expect(lpFeeCandidates(Number.NaN, 9, max)).toEqual([]);
  });
});

describe("cpmmSellQuote", () => {
  it("applies the trade and creator fee, then the constant product", () => {
    // 1,000 coins into 1,000,000 coins / 100 SOL at 0.25% + 0.05%: net 997 → 100e9 × 997 / 1,000,997.
    expect(cpmmSellQuote(1_000n, 1_000_000n, 100_000_000_000n, 2_500n, 500n)).toBe(99_600_698n);
  });

  it("is zero for dust that the fee eats", () => {
    expect(cpmmSellQuote(1n, 1_000_000n, 100_000_000_000n, 2_500n, 500n)).toBe(0n);
  });
});

describe("lock records", () => {
  it("finds the pool's address inside a lock record", () => {
    const pool = pk();
    const data = Buffer.concat([Buffer.alloc(40), pool.toBuffer(), Buffer.alloc(20)]);
    expect(lockNamesPool(data, pool)).toBe(true);
    expect(lockNamesPool(data, pk())).toBe(false);
  });

  it("derives the lock PDA from the Fee Key mint (seed \"locked_liquidity\")", () => {
    const nft = pk();
    const [want] = PublicKey.findProgramAddressSync([Buffer.from("locked_liquidity"), nft.toBuffer()], p.lpLock);
    expect(lockedLiquidityPda(p.lpLock, nft).equals(want)).toBe(true);
  });

  it("asks Raydium's API by lock address and reads the pool and claimable LP", async () => {
    const lock = pk();
    let url = "";
    const fake = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ poolInfo: { id: "POOL" }, positionInfo: { unclaimedFee: { lp: 0.5, amountA: 1, amountB: 2, usdValue: 3 } } }));
    }) as unknown as typeof fetch;
    expect(await fetchLockedPosition("mainnet-beta", lock, fake)).toEqual({ poolId: "POOL", lp: 0.5 });
    expect(url).toBe(`https://dynamic-ipfs.raydium.io/lock/cpmm/position?id=${lock.toBase58()}`);
  });
});

describe("instructions", () => {
  const coin = pk();
  const pool = {
    configId: pk(), poolCreator: pk(), vaultA: pk(), vaultB: pk(), mintLp: pk(), mintA: NATIVE_MINT, mintB: coin,
    mintProgramA: TOKEN_PROGRAM_ID, mintProgramB: TOKEN_2022_PROGRAM_ID, observationId: pk(),
  } as unknown as CpmmPool;
  const owner = pk();
  const poolId = pk();

  it("collect_cp_fee: owner signs, LP amount in the data, owner's ATAs per mint program", () => {
    const nft = pk();
    const ix = collectLockedLpFeeInstruction({ lockProgram: p.lpLock, lockAuth: p.lpLockAuth, cpmmProgram: p.cpmm, owner, nftMint: nft, poolId, pool, lpFeeAmount: 123_456n });
    expect(ix.programId.equals(p.lpLock)).toBe(true);
    expect([...ix.data.subarray(0, 8)]).toEqual([8, 30, 51, 199, 209, 184, 247, 133]);
    expect(ix.data.readBigUInt64LE(8)).toBe(123_456n);
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([owner.toBase58()]);
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys).toContain(ata(owner, nft, TOKEN_PROGRAM_ID).toBase58());
    expect(keys).toContain(lockedLiquidityPda(p.lpLock, nft).toBase58());
    expect(keys).toContain(ata(owner, NATIVE_MINT, TOKEN_PROGRAM_ID).toBase58());
    expect(keys).toContain(ata(owner, coin, TOKEN_2022_PROGRAM_ID).toBase58());
  });

  it("swap_base_input sells the coin from the owner's ATA into WSOL with a minimum out", () => {
    const ix = cpmmSellInstruction({ cpmmProgram: p.cpmm, owner, poolId, pool, coinMint: coin, amountIn: 1_000n, minOut: 900n });
    expect(ix.programId.equals(p.cpmm)).toBe(true);
    expect(ix.data.readBigUInt64LE(8)).toBe(1_000n);
    expect(ix.data.readBigUInt64LE(16)).toBe(900n);
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    // input account, output account, input vault, output vault (cp-swap swap_base_input order)
    expect(keys.slice(4, 8)).toEqual([ata(owner, coin, TOKEN_2022_PROGRAM_ID), ata(owner, NATIVE_MINT, TOKEN_PROGRAM_ID), pool.vaultB, pool.vaultA].map((k) => k.toBase58()));
  });
});

describe("newAtaLen (rent of a holder's new stock account)", () => {
  const tlv = (types: ExtensionType[]) => Buffer.concat(types.map((t) => { const b = Buffer.alloc(4); b.writeUInt16LE(t, 0); return b; }));
  const info = (programId: PublicKey, types: ExtensionType[]) => ({ programId, mint: { tlvData: tlv(types) } as unknown as Mint });

  it("is 165 bytes for an SPL Token mint", () => {
    expect(newAtaLen(info(TOKEN_PROGRAM_ID, []))).toBe(165);
  });

  it("adds the account type and ImmutableOwner for a Token-2022 mint (the ATA program always sets it)", () => {
    expect(newAtaLen(info(TOKEN_2022_PROGRAM_ID, []))).toBe(170);
  });

  it("adds the account extensions an xStock's mint requires, and nothing for mint-only ones", () => {
    // The extensions fetch-xstocks reported on mainnet (2026-10-27). Pausable → PausableAccount
    // (0 bytes), TransferHook → TransferHookAccount (1 byte); the confidential-transfer mint, scaled
    // UI, permanent delegate, default state and metadata need nothing on the account.
    const xstock = [
      ExtensionType.MetadataPointer, ExtensionType.PermanentDelegate, ExtensionType.DefaultAccountState, ExtensionType.ScaledUiAmountConfig,
      ExtensionType.PausableConfig, ExtensionType.ConfidentialTransferMint, ExtensionType.TransferHook, ExtensionType.TokenMetadata,
    ];
    expect(newAtaLen(info(TOKEN_2022_PROGRAM_ID, xstock))).toBe(165 + 1 + 4 + 4 + 5);
  });

  it("follows token-2022's own list: a transfer fee adds its 8-byte amount, non-transferable adds its marker", () => {
    expect(newAtaLen(info(TOKEN_2022_PROGRAM_ID, [ExtensionType.TransferFeeConfig]))).toBe(165 + 1 + 4 + 12);
    expect(newAtaLen(info(TOKEN_2022_PROGRAM_ID, [ExtensionType.NonTransferable]))).toBe(165 + 1 + 4 + 4);
  });
});
