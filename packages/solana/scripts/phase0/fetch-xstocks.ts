/**
 * fetch-xstocks.ts — READ-ONLY. Lists xStocks mints with decimals, token program and Token-2022
 * extensions, cross-checking three sources:
 *
 *   1. CITED_XSTOCKS below — copied from two independent repos (see phase0/jito-jupiter-xstocks.md §3):
 *        solana-foundation/tokens@e87d61f packages/asset-registry/src/data/{xstock-variant-groups,list-mints,etfs}.ts
 *        trustwallet/assets@1047fed blockchains/solana/assets/<mint>/info.json (symbol, decimals=8)
 *   2. Jupiter Tokens API V2 (jup-ag/docs@0066fde openapi-spec/tokens/v2/tokens.yaml):
 *        GET https://api.jup.ag/tokens/v2/search?query=<mint,mint,...>  (<=100 mints)   :12-29
 *        GET https://api.jup.ag/tokens/v2/tag?query=stocks                               :106-123
 *        fields: id, symbol, decimals, tokenProgram, isVerified, tags                    :302-476
 *   3. On-chain mint account via RPC getAccountInfo(jsonParsed) — owner program + extensions
 *      (scaledUiAmountConfig multiplier, pausableConfig.paused, permanentDelegate, transferHook ...).
 *
 * Usage:
 *   npx tsx fetch-xstocks.ts                 # cited mints, Jupiter search by mint, + RPC if RPC_URL set
 *   npx tsx fetch-xstocks.ts --tag           # also list every Jupiter `stocks`-tagged token named "xStock"
 *   npx tsx fetch-xstocks.ts --symbols NVDAx,SPYx   # Jupiter search by symbol; flags non-cited lookalikes
 *   npx tsx fetch-xstocks.ts --json          # machine-readable output
 *
 * Env: JUP_API_KEY (optional, x-api-key; keyless = 0.5 RPS), RPC_URL (optional, for extensions)
 */
import { Connection, PublicKey } from '@solana/web3.js';

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const JUP_TOKENS = process.env.JUP_TOKENS_URL ?? 'https://api.jup.ag/tokens/v2';

/**
 * Only mints that appear in BOTH solana-foundation/tokens (labelled 'xStock') and trustwallet/assets
 * (symbol + "(xStock)" name). Do not add entries from memory.
 */
export const CITED_XSTOCKS: ReadonlyArray<{ symbol: string; mint: string }> = [
  { symbol: 'NVDAx', mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh' },
  { symbol: 'SPYx', mint: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W' },
  { symbol: 'TSLAx', mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB' },
  { symbol: 'AAPLx', mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp' },
  { symbol: 'QQQx', mint: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ' },
  { symbol: 'GOOGLx', mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN' },
  { symbol: 'AMZNx', mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg' },
  { symbol: 'MSTRx', mint: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ' },
  { symbol: 'COINx', mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu' },
  { symbol: 'HOODx', mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg' },
  { symbol: 'CRCLx', mint: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1' },
];

interface JupToken {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  tokenProgram?: string;
  isVerified?: boolean | null;
  tags?: string[] | null;
  usdPrice?: number;
  liquidity?: number;
}

interface ParsedExtension {
  extension: string;
  state?: Record<string, unknown>;
}

interface Row {
  symbol: string;
  mint: string;
  cited: boolean;
  jupSymbol?: string;
  jupName?: string;
  jupVerified?: boolean | null;
  jupTags?: string[] | null;
  jupDecimals?: number;
  jupTokenProgram?: string;
  usdPrice?: number;
  liquidity?: number;
  rpcOwner?: string;
  rpcDecimals?: number;
  extensions?: string[];
  scaledUiMultiplier?: string;
  scaledUiNewMultiplier?: string;
  scaledUiNewEffective?: string;
  paused?: unknown;
  permanentDelegate?: unknown;
  transferHookProgram?: unknown;
  defaultAccountState?: unknown;
  problems: string[];
}

function jupHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (process.env.JUP_API_KEY) h['x-api-key'] = process.env.JUP_API_KEY;
  return h;
}

async function jupGet<T>(path: string): Promise<T> {
  const url = `${JUP_TOKENS}${path}`;
  const res = await fetch(url, { headers: jupHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchMintOnChain(connection: Connection, mint: string) {
  const info = await connection.getParsedAccountInfo(new PublicKey(mint), 'confirmed');
  const v = info.value;
  if (!v) return null;
  const data = v.data as unknown;
  let decimals: number | undefined;
  let extensions: ParsedExtension[] = [];
  if (data && typeof data === 'object' && 'parsed' in (data as Record<string, unknown>)) {
    const parsed = (data as { parsed: { info?: { decimals?: number; extensions?: ParsedExtension[] } } }).parsed;
    decimals = parsed.info?.decimals;
    extensions = parsed.info?.extensions ?? [];
  }
  return { owner: v.owner.toBase58(), decimals, extensions };
}

function stateOf(exts: ParsedExtension[], name: string): Record<string, unknown> | undefined {
  return exts.find((e) => e.extension === name)?.state;
}

async function main() {
  const asJson = process.argv.includes('--json');
  const rows: Row[] = CITED_XSTOCKS.map((c) => ({ symbol: c.symbol, mint: c.mint, cited: true, problems: [] }));

  // 2a. Jupiter search by mint list (single request; <=100 mints).
  try {
    const list = await jupGet<JupToken[]>(`/search?query=${CITED_XSTOCKS.map((c) => c.mint).join(',')}`);
    const byId = new Map(list.map((t) => [t.id, t]));
    for (const r of rows) {
      const t = byId.get(r.mint);
      if (!t) {
        r.problems.push('not returned by Jupiter /tokens/v2/search');
        continue;
      }
      Object.assign(r, {
        jupSymbol: t.symbol,
        jupName: t.name,
        jupVerified: t.isVerified,
        jupTags: t.tags,
        jupDecimals: t.decimals,
        jupTokenProgram: t.tokenProgram,
        usdPrice: t.usdPrice,
        liquidity: t.liquidity,
      });
      if (t.symbol.toLowerCase() !== r.symbol.toLowerCase()) r.problems.push(`Jupiter symbol ${t.symbol} != ${r.symbol}`);
      if (!t.isVerified) r.problems.push('Jupiter isVerified is not true');
      if (t.tokenProgram && t.tokenProgram !== TOKEN_2022) r.problems.push(`tokenProgram ${t.tokenProgram} is not Token-2022`);
    }
  } catch (e) {
    for (const r of rows) r.problems.push(`Jupiter search failed: ${(e as Error).message.split('\n')[0]}`);
  }

  // 2b. Optional: search by symbol, flag lookalikes (Ondo/Backpack/scam tokens share tickers).
  const symArg = process.argv[process.argv.indexOf('--symbols') + 1];
  if (process.argv.includes('--symbols') && symArg) {
    for (const sym of symArg.split(',')) {
      await sleep(2_100); // keyless limit 0.5 RPS
      const hits = await jupGet<JupToken[]>(`/search?query=${encodeURIComponent(sym)}`);
      console.log(`\n/search?query=${sym}: ${hits.length} result(s)`);
      for (const h of hits) {
        const cited = CITED_XSTOCKS.some((c) => c.mint === h.id);
        console.log(
          `  ${cited ? 'CITED ' : '      '}${h.symbol.padEnd(8)} ${h.id} dec=${h.decimals} verified=${h.isVerified} ` +
            `prog=${h.tokenProgram === TOKEN_2022 ? 'Token-2022' : h.tokenProgram === SPL_TOKEN ? 'SPL' : h.tokenProgram} name="${h.name}"`,
        );
      }
    }
  }

  // 2c. Optional: whole `stocks` tag, filtered to names containing "xStock".
  if (process.argv.includes('--tag')) {
    await sleep(2_100);
    const tagged = await jupGet<JupToken[]>('/tag?query=stocks');
    const xs = tagged.filter((t) => /xstock/i.test(t.name));
    console.log(`\n/tag?query=stocks: ${tagged.length} tokens, ${xs.length} with "xStock" in name`);
    for (const t of xs) {
      const cited = CITED_XSTOCKS.some((c) => c.mint === t.id);
      console.log(`  ${cited ? 'CITED ' : '      '}${t.symbol.padEnd(8)} ${t.id} dec=${t.decimals} verified=${t.isVerified}`);
    }
  }

  // 3. On-chain extensions.
  const rpcUrl = process.env.RPC_URL;
  if (rpcUrl) {
    const connection = new Connection(rpcUrl, 'confirmed');
    for (const r of rows) {
      try {
        const m = await fetchMintOnChain(connection, r.mint);
        if (!m) {
          r.problems.push('mint account not found on-chain');
          continue;
        }
        r.rpcOwner = m.owner === TOKEN_2022 ? 'Token-2022' : m.owner === SPL_TOKEN ? 'SPL Token' : m.owner;
        r.rpcDecimals = m.decimals;
        r.extensions = m.extensions.map((e) => e.extension);
        const s = stateOf(m.extensions, 'scaledUiAmountConfig');
        if (s) {
          r.scaledUiMultiplier = String(s.multiplier);
          r.scaledUiNewMultiplier = String(s.newMultiplier);
          r.scaledUiNewEffective = String(s.newMultiplierEffectiveTimestamp);
        }
        r.paused = stateOf(m.extensions, 'pausableConfig')?.paused;
        r.permanentDelegate = stateOf(m.extensions, 'permanentDelegate')?.delegate;
        r.transferHookProgram = stateOf(m.extensions, 'transferHook')?.programId;
        r.defaultAccountState = stateOf(m.extensions, 'defaultAccountState')?.accountState;
        if (m.owner !== TOKEN_2022) r.problems.push('on-chain owner is not Token-2022');
        if (r.jupDecimals !== undefined && m.decimals !== undefined && r.jupDecimals !== m.decimals) {
          r.problems.push(`decimals mismatch Jupiter=${r.jupDecimals} chain=${m.decimals}`);
        }
        if (r.paused === true) r.problems.push('MINT IS PAUSED — transfers will fail (MintPaused)');
        if (r.transferHookProgram) r.problems.push('transfer hook program is SET — transfers need extra accounts');
        if (r.defaultAccountState && r.defaultAccountState !== 'initialized') {
          r.problems.push(`defaultAccountState=${String(r.defaultAccountState)} — new ATAs start frozen`);
        }
      } catch (e) {
        r.problems.push(`RPC error: ${(e as Error).message}`);
      }
    }
  } else {
    console.error('(RPC_URL not set: skipping on-chain token program / extension check)');
  }

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log('\nsymbol   mint                                          dec(jup/chain) program(jup|chain)       verified ext / multiplier / paused');
  for (const r of rows) {
    const prog = `${r.jupTokenProgram === TOKEN_2022 ? 'T22' : r.jupTokenProgram ?? '?'}|${r.rpcOwner ?? '?'}`;
    console.log(
      `${r.symbol.padEnd(8)} ${r.mint.padEnd(45)} ${String(r.jupDecimals ?? '?')}/${String(r.rpcDecimals ?? '?')}`.padEnd(70) +
        ` ${prog.padEnd(24)} ${String(r.jupVerified ?? '?').padEnd(8)} ` +
        `${(r.extensions ?? []).join(',') || '-'} / ${r.scaledUiMultiplier ?? '-'} / ${String(r.paused ?? '-')}`,
    );
    for (const p of r.problems) console.log(`         ! ${p}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
