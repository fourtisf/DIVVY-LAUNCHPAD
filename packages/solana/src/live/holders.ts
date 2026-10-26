/**
 * Holder snapshot for a coin mint.
 * Primary: Helius DAS getTokenAccounts {mint, limit, cursor, options.showZeroBalance}
 * (helius-sdk src/types/das.ts:643-662). Fallback: getProgramAccounts on the token program with a
 * memcmp on the mint at offset 0 and NO dataSize filter, because Token-2022 accounts with
 * extensions are longer than 165 bytes (token-2022 interface/src/extension/mod.rs:311-314).
 */
import { Connection, PublicKey } from "@solana/web3.js";

export interface HolderBalance {
  owner: string;
  /** Raw base units, summed over the owner's token accounts. */
  amount: bigint;
}

interface DasResponse {
  result?: { cursor?: string | null; token_accounts: { owner: string; amount: number | string; frozen?: boolean }[] };
  error?: { message: string };
}

async function viaDas(rpcUrl: string, mint: string, fetchImpl: typeof fetch): Promise<Map<string, bigint>> {
  const totals = new Map<string, bigint>();
  let cursor: string | undefined;
  for (let page = 0; page < 10_000; page++) {
    const body = { jsonrpc: "2.0", id: "divvy", method: "getTokenAccounts", params: { mint, limit: 1000, cursor, options: { showZeroBalance: false } } };
    const res = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    // Parse amounts as strings so u64 balances never round through a JS number.
    const text = (await res.text()).replace(/"amount":\s*(\d+)/g, '"amount":"$1"');
    const json = JSON.parse(text) as DasResponse;
    if (json.error || !json.result) throw new Error(json.error?.message ?? "getTokenAccounts failed");
    for (const a of json.result.token_accounts) {
      if (a.frozen) continue;
      totals.set(a.owner, (totals.get(a.owner) ?? 0n) + BigInt(a.amount));
    }
    if (!json.result.cursor || json.result.token_accounts.length === 0) break;
    cursor = json.result.cursor;
  }
  return totals;
}

async function viaGpa(conn: Connection, mint: PublicKey, tokenProgram: PublicKey): Promise<Map<string, bigint>> {
  const accounts = await conn.getProgramAccounts(tokenProgram, {
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
    dataSlice: { offset: 0, length: 109 },
  });
  const totals = new Map<string, bigint>();
  for (const { account } of accounts) {
    const d = account.data;
    if (d.length < 109) continue;
    // Account layout: mint 0..32, owner 32..64, amount 64..72, ..., state at 108 (2 = frozen).
    if (d[108] === 2) continue;
    const owner = new PublicKey(d.subarray(32, 64)).toBase58();
    const amount = d.readBigUInt64LE(64);
    if (amount > 0n) totals.set(owner, (totals.get(owner) ?? 0n) + amount);
  }
  return totals;
}

export async function snapshotHolders(
  conn: Connection,
  mint: PublicKey,
  tokenProgram: PublicKey,
  opts: { das?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<HolderBalance[]> {
  let totals: Map<string, bigint>;
  if (opts.das !== false) {
    try {
      totals = await viaDas(conn.rpcEndpoint, mint.toBase58(), opts.fetchImpl ?? fetch);
    } catch {
      totals = await viaGpa(conn, mint, tokenProgram);
    }
  } else totals = await viaGpa(conn, mint, tokenProgram);
  return [...totals].map(([owner, amount]) => ({ owner, amount })).sort((a, b) => (a.amount < b.amount ? 1 : a.amount > b.amount ? -1 : 0));
}
