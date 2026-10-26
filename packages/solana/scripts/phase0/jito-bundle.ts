/**
 * jito-bundle.ts — minimal Jito Block Engine JSON-RPC client + CLI.
 *
 * Sources (see phase0/jito-jupiter-xstocks.md for line-level citations):
 *   jito-labs/jito-docs@9b923b8 docs/source/lowlatencytxnsend.md
 *     - endpoints: /api/v1/bundles (sendBundle), /api/v1/getBundleStatuses,
 *       /api/v1/getInflightBundleStatuses, /api/v1/getTipAccounts
 *     - max 5 txs per bundle, base64 recommended (base58 deprecated, but default),
 *       min tip 1000 lamports, 1 req/s per IP per region, auth via x-jito-auth header or ?uuid=
 *   jito-labs/jito-js-rpc@7f05783 src/index.ts (uses /bundles for every bundle method)
 *
 * SAFETY:
 *   - Default for `send` is DRY RUN: prints the JSON-RPC payload, sends nothing.
 *   - A real sendBundle needs BOTH `--send` AND env I_HAVE_OWNER_APPROVAL=yes.
 *   - `tip-accounts` and `status` are read-only.
 *
 * Usage:
 *   npx tsx jito-bundle.ts tip-accounts [--region ny]
 *   npx tsx jito-bundle.ts send --tx <base64> [--tx <base64> ...] [--file txs.txt] [--region ny] [--send]
 *   npx tsx jito-bundle.ts status <bundleId> [<bundleId> ...] [--inflight] [--poll]
 *
 * Env:
 *   JITO_BLOCK_ENGINE_URL  override base URL (default https://mainnet.block-engine.jito.wtf)
 *   JITO_UUID              optional UUID (sent as x-jito-auth header)
 *   I_HAVE_OWNER_APPROVAL  must be "yes" for --send to actually POST sendBundle
 */
import { readFileSync } from 'node:fs';
import { SystemProgram, VersionedTransaction } from '@solana/web3.js';

export const MAX_BUNDLE_TXS = 5; // jito-docs lowlatencytxnsend.md:25,158,178
export const MIN_TIP_LAMPORTS = 1000; // jito-docs lowlatencytxnsend.md:81,668,677
export const DEFAULT_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf';

/** Regional hosts, from jito-docs lowlatencytxnsend.md:56-64 (mainnet table). */
export const MAINNET_REGIONS: Record<string, string> = {
  global: 'https://mainnet.block-engine.jito.wtf',
  amsterdam: 'https://amsterdam.mainnet.block-engine.jito.wtf',
  dublin: 'https://dublin.mainnet.block-engine.jito.wtf',
  frankfurt: 'https://frankfurt.mainnet.block-engine.jito.wtf',
  london: 'https://london.mainnet.block-engine.jito.wtf',
  ny: 'https://ny.mainnet.block-engine.jito.wtf',
  slc: 'https://slc.mainnet.block-engine.jito.wtf',
  singapore: 'https://singapore.mainnet.block-engine.jito.wtf',
  tokyo: 'https://tokyo.mainnet.block-engine.jito.wtf',
};

/** Method -> path, as shown in the curl examples of jito-docs lowlatencytxnsend.md. */
const METHOD_PATH: Record<JitoMethod, string> = {
  sendBundle: '/api/v1/bundles', // :184
  getBundleStatuses: '/api/v1/getBundleStatuses', // :257
  getTipAccounts: '/api/v1/getTipAccounts', // :336
  getInflightBundleStatuses: '/api/v1/getInflightBundleStatuses', // :391
};

export type JitoMethod =
  | 'sendBundle'
  | 'getBundleStatuses'
  | 'getTipAccounts'
  | 'getInflightBundleStatuses';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: JitoMethod;
  params: unknown[];
}

export interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface BundleStatus {
  bundle_id: string;
  transactions: string[];
  slot: number;
  confirmation_status: 'processed' | 'confirmed' | 'finalized' | null;
  err: unknown;
}

export interface InflightBundleStatus {
  bundle_id: string;
  status: 'Invalid' | 'Pending' | 'Failed' | 'Landed';
  landed_slot: number | null;
}

export interface ContextResult<T> {
  context: { slot: number };
  value: T;
}

export interface BundleCheck {
  index: number;
  signature: string | null;
  signed: boolean;
  sizeBytes: number;
  paysTipTo: string | null;
  tipLamports: number | null;
  warnings: string[];
}

export class JitoClient {
  private nextId = 1;

  constructor(
    readonly baseUrl: string = process.env.JITO_BLOCK_ENGINE_URL ?? DEFAULT_BLOCK_ENGINE,
    private readonly uuid: string | undefined = process.env.JITO_UUID || undefined,
  ) {}

  buildRequest(method: JitoMethod, params: unknown[]): { url: string; headers: Record<string, string>; body: JsonRpcRequest } {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // jito-docs lowlatencytxnsend.md:144-154: x-jito-auth header (or ?uuid= query param)
    if (this.uuid) headers['x-jito-auth'] = this.uuid;
    return {
      url: `${this.baseUrl.replace(/\/$/, '')}${METHOD_PATH[method]}`,
      headers,
      body: { jsonrpc: '2.0', id: this.nextId++, method, params },
    };
  }

  /** Payload for sendBundle with base64 encoding (jito-docs lowlatencytxnsend.md:178-199). */
  buildSendBundleRequest(base64Txs: string[]) {
    if (base64Txs.length < 1 || base64Txs.length > MAX_BUNDLE_TXS) {
      throw new Error(`bundle must contain 1..${MAX_BUNDLE_TXS} transactions, got ${base64Txs.length}`);
    }
    return this.buildRequest('sendBundle', [base64Txs, { encoding: 'base64' }]);
  }

  private async post<T>(req: { url: string; headers: Record<string, string>; body: JsonRpcRequest }): Promise<T> {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
    const text = await res.text();
    if (res.status === 429) throw new Error(`429 rate limited by block engine (default 1 req/s/IP/region): ${text}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${req.url}: ${text}`);
    const json = JSON.parse(text) as JsonRpcResponse<T>;
    if (json.error) throw new Error(`JSON-RPC error ${json.error.code}: ${json.error.message}`);
    return json.result as T;
  }

  /** Read-only. */
  getTipAccounts(): Promise<string[]> {
    return this.post<string[]>(this.buildRequest('getTipAccounts', []));
  }

  /** Read-only. Up to 5 ids. Result is null/empty until the bundle lands. */
  getBundleStatuses(bundleIds: string[]): Promise<ContextResult<(BundleStatus | null)[]> | null> {
    if (bundleIds.length > 5) throw new Error('max 5 bundle ids per request');
    return this.post(this.buildRequest('getBundleStatuses', [bundleIds]));
  }

  /** Read-only. Up to 5 ids, 5-minute lookback. */
  getInflightBundleStatuses(bundleIds: string[]): Promise<ContextResult<InflightBundleStatus[]> | null> {
    if (bundleIds.length > 5) throw new Error('max 5 bundle ids per request');
    return this.post(this.buildRequest('getInflightBundleStatuses', [bundleIds]));
  }

  /**
   * Sends a bundle. Refuses unless the caller passes `approved: true`, which the CLI only sets
   * when both --send and I_HAVE_OWNER_APPROVAL=yes are present.
   */
  async sendBundle(base64Txs: string[], opts: { approved: boolean }): Promise<string> {
    if (!opts.approved) throw new Error('sendBundle refused: owner approval not given');
    return this.post<string>(this.buildSendBundleRequest(base64Txs));
  }

  /**
   * Polls getInflightBundleStatuses until Landed/Failed/Invalid or timeout, then fetches
   * getBundleStatuses for the landed slot/confirmation. Interval >= 1.1s to respect 1 rps.
   */
  async pollBundle(bundleId: string, timeoutMs = 60_000, intervalMs = 1_500): Promise<{
    inflight: InflightBundleStatus | null;
    final: BundleStatus | null;
  }> {
    const start = Date.now();
    let inflight: InflightBundleStatus | null = null;
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await this.getInflightBundleStatuses([bundleId]);
        inflight = r?.value?.[0] ?? null;
        if (inflight && inflight.status !== 'Pending') break;
      } catch (e) {
        console.error(`poll error: ${(e as Error).message}`);
      }
      await sleep(Math.max(intervalMs, 1_100));
    }
    let final: BundleStatus | null = null;
    if (inflight?.status === 'Landed') {
      await sleep(1_100);
      const r = await this.getBundleStatuses([bundleId]);
      final = r?.value?.[0] ?? null;
    }
    return { inflight, final };
  }
}

/**
 * Offline sanity checks on base64 txs: deserializes, checks signatures are present, and looks
 * for a SystemProgram transfer to one of `tipAccounts` in the static account keys (Jito docs
 * warn not to reference tip accounts via Address Lookup Tables — lowlatencytxnsend.md:579).
 */
export function inspectBundle(base64Txs: string[], tipAccounts: string[] = []): BundleCheck[] {
  const tipSet = new Set(tipAccounts);
  return base64Txs.map((b64, index) => {
    const warnings: string[] = [];
    const raw = Buffer.from(b64, 'base64');
    const tx = VersionedTransaction.deserialize(raw);
    const sig0 = tx.signatures[0];
    const signed = tx.signatures.length > 0 && tx.signatures.every((s) => s.some((b) => b !== 0));
    if (!signed) warnings.push('one or more signatures are all-zero (unsigned) — block engine needs fully-signed txs');
    const keys = tx.message.staticAccountKeys;
    let paysTipTo: string | null = null;
    let tipLamports: number | null = null;
    for (const ix of tx.message.compiledInstructions) {
      const program = keys[ix.programIdIndex];
      if (!program || !program.equals(SystemProgram.programId)) continue;
      const data = Buffer.from(ix.data);
      // SystemInstruction::Transfer = u32 LE 2, followed by u64 LE lamports
      if (data.length === 12 && data.readUInt32LE(0) === 2) {
        const destIdx = ix.accountKeyIndexes[1];
        const dest = destIdx !== undefined && destIdx < keys.length ? keys[destIdx] : undefined;
        if (dest && tipSet.has(dest.toBase58())) {
          paysTipTo = dest.toBase58();
          tipLamports = Number(data.readBigUInt64LE(4));
        }
      }
    }
    if (tipSet.size > 0) {
      const lutTip = tx.message.addressTableLookups.length > 0 && paysTipTo === null;
      if (lutTip) warnings.push('tx uses ALTs and no tip transfer found in static keys (tip accounts must not come from an ALT)');
    }
    if (tipLamports !== null && tipLamports < MIN_TIP_LAMPORTS) {
      warnings.push(`tip ${tipLamports} < documented minimum ${MIN_TIP_LAMPORTS} lamports`);
    }
    return {
      index,
      signature: sig0 && signed ? base58(sig0) : null,
      signed,
      sizeBytes: raw.length,
      paysTipTo,
      tipLamports,
      warnings,
    };
  });
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Minimal base58 encoder (for printing tx signatures; avoids an extra dependency). */
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- CLI ----------------

function argValues(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1]) out.push(argv[++i] as string);
  return out;
}

function resolveBaseUrl(argv: string[]): string {
  const region = argValues(argv, '--region')[0];
  if (region) {
    const url = MAINNET_REGIONS[region];
    if (!url) throw new Error(`unknown region ${region}; one of ${Object.keys(MAINNET_REGIONS).join(', ')}`);
    return url;
  }
  return process.env.JITO_BLOCK_ENGINE_URL ?? DEFAULT_BLOCK_ENGINE;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const client = new JitoClient(resolveBaseUrl(argv));

  if (cmd === 'tip-accounts') {
    const accounts = await client.getTipAccounts();
    console.log(JSON.stringify(accounts, null, 2));
    return;
  }

  if (cmd === 'status') {
    const ids = argv.slice(1).filter((a) => !a.startsWith('--'));
    if (ids.length === 0) throw new Error('status needs at least one bundle id');
    if (argv.includes('--poll')) {
      console.log(JSON.stringify(await client.pollBundle(ids[0] as string), null, 2));
    } else if (argv.includes('--inflight')) {
      console.log(JSON.stringify(await client.getInflightBundleStatuses(ids), null, 2));
    } else {
      console.log(JSON.stringify(await client.getBundleStatuses(ids), null, 2));
    }
    return;
  }

  if (cmd === 'send') {
    const txs = [...argValues(argv, '--tx')];
    for (const f of argValues(argv, '--file')) {
      txs.push(...readFileSync(f, 'utf8').split(/\s+/).filter(Boolean));
    }
    if (txs.length === 0) throw new Error('send needs --tx <base64> or --file <path>');

    const tipAccounts = argValues(argv, '--tip-account');
    const checks = inspectBundle(txs, tipAccounts);
    console.error('offline checks:', JSON.stringify(checks, null, 2));
    if (tipAccounts.length > 0 && !checks.some((c) => c.paysTipTo)) {
      console.error('WARNING: no transfer to a provided tip account found; the bundle would not be considered.');
    }

    const req = client.buildSendBundleRequest(txs);
    const wantSend = argv.includes('--send');
    const approved = process.env.I_HAVE_OWNER_APPROVAL === 'yes';
    if (!wantSend || !approved) {
      console.log('DRY RUN — nothing sent. Would POST:');
      console.log(JSON.stringify({ url: req.url, headers: redact(req.headers), body: req.body }, null, 2));
      if (wantSend && !approved) console.error('Refusing to send: set I_HAVE_OWNER_APPROVAL=yes together with --send.');
      return;
    }
    const bundleId = await client.sendBundle(txs, { approved: true });
    console.log(`bundle id: ${bundleId}`);
    console.log(JSON.stringify(await client.pollBundle(bundleId), null, 2));
    return;
  }

  console.error('usage: jito-bundle.ts tip-accounts | send --tx <b64>... [--send] | status <id>... [--inflight|--poll]');
  process.exitCode = 2;
}

function redact(h: Record<string, string>): Record<string, string> {
  const out = { ...h };
  if (out['x-jito-auth']) out['x-jito-auth'] = '<redacted>';
  return out;
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
