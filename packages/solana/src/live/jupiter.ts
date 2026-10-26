/**
 * Jupiter Swap API v2 and Price API v3 (jup-ag/docs@0066fde):
 * - GET /swap/v2/build returns raw instructions we can put in our own transaction or Jito bundle;
 *   forJitoBundle=true excludes incompatible DEXes (swap/index.mdx:213, swap.yaml:556-563).
 * - /build has no CU-limit instruction (swap.yaml:604-608): we add one.
 * - priceImpactPct on /build is a decimal ratio ("0.001" = 0.1%) (swap.yaml:597-599).
 * - GET /price/v3?ids= (price/v3/price.yaml:8,24), up to 50 ids.
 * - GET /tokens/v2/{category}/{interval} (tokens/v2/tokens.yaml:7-8,163-215) for the reserved-ticker list.
 */
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

interface ApiIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

export interface BuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  computeBudgetInstructions: ApiIx[];
  setupInstructions: ApiIx[];
  swapInstruction: ApiIx;
  cleanupInstruction: ApiIx | null;
  otherInstructions: ApiIx[];
  addressesByLookupTableAddress: Record<string, string[]> | null;
  error?: string;
}

/** Jupiter's swap program (jup-ag/docs@0066fde swap/v1/common-errors.mdx:23, ultra/response.mdx:263). */
export const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

export interface BuiltSwap {
  inputMint: string;
  outputMint: string;
  instructions: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
  inAmount: bigint;
  outAmount: bigint;
  minOut: bigint;
  /** Price impact in basis points (from the decimal ratio). */
  priceImpactBps: number;
}

const toIx = (i: ApiIx) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, "base64"),
  });

export class JupiterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const res = await this.fetchImpl(this.baseUrl.replace(/\/$/, "") + path, { headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`jupiter ${path.split("?")[0]}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }

  async build(p: {
    inputMint: string;
    outputMint: string;
    amount: bigint;
    taker: PublicKey;
    slippageBps: number;
    forJitoBundle?: boolean;
    destinationTokenAccount?: PublicKey;
    cuLimit?: number;
  }): Promise<BuiltSwap> {
    const q = new URLSearchParams({
      inputMint: p.inputMint,
      outputMint: p.outputMint,
      amount: p.amount.toString(),
      taker: p.taker.toBase58(),
      slippageBps: String(p.slippageBps),
    });
    if (p.forJitoBundle) q.set("forJitoBundle", "true");
    if (p.destinationTokenAccount) q.set("destinationTokenAccount", p.destinationTokenAccount.toBase58());
    const b = await this.get<BuildResponse>(`/swap/v2/build?${q}`);
    if (b.error) throw new Error(`jupiter build: ${b.error}`);
    const lookupTables = Object.entries(b.addressesByLookupTableAddress ?? {}).map(
      ([key, addrs]) =>
        new AddressLookupTableAccount({
          key: new PublicKey(key),
          state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: addrs.map((a) => new PublicKey(a)) },
        }),
    );
    return {
      inputMint: b.inputMint,
      outputMint: b.outputMint,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: p.cuLimit ?? 600_000 }),
        // Our own CU limit is set above; a second SetComputeUnitLimit (tag 2) would fail the transaction.
        ...b.computeBudgetInstructions.map(toIx).filter((ix) => ix.data[0] !== 2),
        ...b.setupInstructions.map(toIx),
        toIx(b.swapInstruction),
        ...(b.cleanupInstruction ? [toIx(b.cleanupInstruction)] : []),
        ...b.otherInstructions.map(toIx),
      ],
      lookupTables,
      inAmount: BigInt(b.inAmount),
      outAmount: BigInt(b.outAmount),
      minOut: BigInt(b.otherAmountThreshold),
      priceImpactBps: Math.round(Math.abs(parseFloat(b.priceImpactPct || "0")) * 10_000),
    };
  }

  /** USD prices keyed by mint (Price API v3). Missing mints are left out. */
  async prices(mints: string[]): Promise<Record<string, number>> {
    const full = await this.priceDetails(mints);
    return Object.fromEntries(Object.entries(full).map(([m, v]) => [m, v.usdPrice]));
  }

  /** Price API v3 with the 24h change (price/v3/price.yaml:53-73: usdPrice, priceChange24h). */
  async priceDetails(mints: string[]): Promise<Record<string, { usdPrice: number; priceChange24h: number | null }>> {
    const out: Record<string, { usdPrice: number; priceChange24h: number | null }> = {};
    for (let i = 0; i < mints.length; i += 50) {
      const chunk = mints.slice(i, i + 50);
      const r = await this.get<Record<string, { usdPrice?: number; priceChange24h?: number | null } | null>>(`/price/v3?ids=${chunk.join(",")}`);
      for (const [mint, v] of Object.entries(r)) if (v?.usdPrice) out[mint] = { usdPrice: v.usdPrice, priceChange24h: v.priceChange24h ?? null };
    }
    return out;
  }

  /**
   * Tokens API v2 top lists (tokens/v2/tokens.yaml:163-215): /tokens/v2/{toporganicscore|toptraded|toptrending}/{5m|1h|6h|24h},
   * limit ≤ 100. Generic tokens like SOL and USDC are filtered out by Jupiter.
   */
  async topTokens(category: "toporganicscore" | "toptraded" | "toptrending", interval: "5m" | "1h" | "6h" | "24h", limit = 100): Promise<{ id: string; symbol: string }[]> {
    const r = await this.get<{ id: string; symbol: string }[]>(`/tokens/v2/${category}/${interval}?limit=${Math.min(100, Math.max(1, limit))}`);
    return Array.isArray(r) ? r.filter((t) => typeof t?.symbol === "string") : [];
  }
}

export function swapTransaction(payer: PublicKey, built: BuiltSwap, recentBlockhash: string, extra: TransactionInstruction[] = []): VersionedTransaction {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: [...built.instructions, ...extra] }).compileToV0Message(built.lookupTables);
  return new VersionedTransaction(msg);
}
