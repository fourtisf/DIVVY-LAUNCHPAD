/**
 * jupiter-quote-xstock.ts — READ-ONLY. Quote SOL -> xStock via Jupiter Swap API V2.
 *
 * Never signs, never sends. The optional --simulate path compiles an UNSIGNED v0 tx from the
 * /build instructions and calls simulateTransaction with sigVerify=false.
 *
 * Sources (jup-ag/docs@0066fde; see phase0/jito-jupiter-xstocks.md):
 *   - Base URL https://api.jup.ag/swap/v2 ............ openapi-spec/swap/v2/swap.yaml:9-11
 *   - GET /order (quote only when taker omitted) ...... swap/index.mdx:45, swap.yaml:177-185
 *   - GET /build (Metis-only raw instructions) ......... swap.yaml:443-672
 *   - forJitoBundle=true on /build ..................... swap.yaml:556-563
 *   - priceImpact (pct points) / priceImpactPct (deprecated on /order; decimal on /build)
 *                                                        swap.yaml:315-330, 597-599
 *   - keyless 0.5 RPS; x-api-key header for more ....... swap/index.mdx:48,86
 *   - V1 (/swap/v1/quote, /swap-instructions) is "no longer actively maintained" swap/v1/index.mdx:9-11
 *
 * Usage:
 *   npx tsx jupiter-quote-xstock.ts --mint <xStockMint> --lamports 100000000
 *   npx tsx jupiter-quote-xstock.ts --mint <xStockMint> --lamports 100000000 --build --taker <pubkey> [--simulate]
 *
 * Flags:
 *   --mint <pubkey>        output mint (xStock). Required.
 *   --lamports <n>         input SOL amount in lamports. Required.
 *   --slippage-bps <n>     default 50
 *   --build                use GET /swap/v2/build (needs --taker); default is GET /swap/v2/order (quote only)
 *   --taker <pubkey>       wallet that would swap (only used to build instructions; nothing is signed)
 *   --no-jito              do NOT pass forJitoBundle=true on /build
 *   --simulate             compile unsigned v0 tx from /build and simulate (needs RPC_URL)
 *   --dest-token-account   pass destinationTokenAccount to /build
 *
 * Env: JUP_API_KEY (optional; sent as x-api-key), RPC_URL (for --simulate), JUP_BASE_URL (override)
 */
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const BASE = process.env.JUP_BASE_URL ?? 'https://api.jup.ag/swap/v2';
const CU_LIMIT_FOR_SIM = 1_400_000;

interface ApiAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}
interface ApiInstruction {
  programId: string;
  accounts: ApiAccount[];
  data: string; // base64
}
interface RoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
  };
  percent?: number;
  bps?: number;
}
interface OrderResponse {
  router?: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpact?: number; // percentage points (e.g. -0.1 = -0.1%)
  priceImpactPct?: string; // deprecated on /order
  routePlan?: RoutePlanStep[];
  feeBps?: number;
  feeMint?: string;
  transaction?: string | null;
  error?: string;
  errorCode?: number;
  errorMessage?: string;
}
interface BuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string; // decimal ratio on /build ("0.001" = 0.1%)
  routePlan: RoutePlanStep[];
  computeBudgetInstructions: ApiInstruction[]; // CU price only (no CU limit) per swap.yaml:604-608
  setupInstructions: ApiInstruction[];
  swapInstruction: ApiInstruction;
  cleanupInstruction: ApiInstruction | null;
  otherInstructions: ApiInstruction[];
  tipInstruction: ApiInstruction | null;
  addressesByLookupTableAddress: Record<string, string[]> | null;
  transactionVersion?: number;
  blockhashWithMetadata?: { blockhash: number[]; lastValidBlockHeight: number };
  error?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (process.env.JUP_API_KEY) h['x-api-key'] = process.env.JUP_API_KEY;
  return h;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: headers() });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}\n${text}`);
  return JSON.parse(text) as T;
}

function toIx(i: ApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, 'base64'),
  });
}

function printRoute(routePlan: RoutePlanStep[] | undefined) {
  for (const [n, s] of (routePlan ?? []).entries()) {
    const share = s.bps !== undefined ? `${s.bps} bps` : `${s.percent}%`;
    console.log(
      `  [${n}] ${s.swapInfo.label} amm=${s.swapInfo.ammKey} ${s.swapInfo.inputMint.slice(0, 6)}…→${s.swapInfo.outputMint.slice(0, 6)}… ` +
        `in=${s.swapInfo.inAmount} out=${s.swapInfo.outAmount} share=${share}`,
    );
  }
}

async function main() {
  const mint = arg('--mint');
  const lamports = arg('--lamports');
  if (!mint || !lamports) {
    console.error('usage: --mint <xStockMint> --lamports <n> [--build --taker <pk> [--simulate]]');
    process.exitCode = 2;
    return;
  }
  new PublicKey(mint); // validate
  if (!/^\d+$/.test(lamports)) throw new Error('--lamports must be an integer');
  const slippageBps = arg('--slippage-bps') ?? '50';

  if (!flag('--build')) {
    // Meta-Aggregator quote. No taker => quote only, transaction: null (swap/index.mdx:45,185).
    const qs = new URLSearchParams({ inputMint: WSOL_MINT, outputMint: mint, amount: lamports, slippageBps });
    const url = `${BASE}/order?${qs}`;
    console.log(`GET ${url}`);
    const q = await getJson<OrderResponse>(url);
    if (q.error || q.errorMessage) console.log(`error: ${q.error ?? q.errorMessage} (code ${q.errorCode ?? '-'})`);
    console.log(`router:           ${q.router}`);
    console.log(`inAmount:         ${q.inAmount} lamports`);
    console.log(`outAmount:        ${q.outAmount} (raw base units of output mint; NOT scaled-UI adjusted)`);
    console.log(`otherAmountThr.:  ${q.otherAmountThreshold}`);
    console.log(`priceImpact:      ${q.priceImpact} (percentage points)`);
    console.log(`priceImpactPct:   ${q.priceImpactPct} (deprecated decimal ratio)`);
    console.log(`feeBps/feeMint:   ${q.feeBps} / ${q.feeMint}`);
    console.log('routePlan:');
    printRoute(q.routePlan);
    console.log(
      'NOTE: /order routes may be JupiterZ RFQ (router=jupiterz). Those txs cannot be modified or bundled; ' +
        'for a Jito bundle use --build (Metis only).',
    );
    return;
  }

  const taker = arg('--taker');
  if (!taker) throw new Error('--build requires --taker <pubkey>');
  const qs = new URLSearchParams({
    inputMint: WSOL_MINT,
    outputMint: mint,
    amount: lamports,
    taker: new PublicKey(taker).toBase58(),
    slippageBps,
  });
  if (!flag('--no-jito')) qs.set('forJitoBundle', 'true');
  const dest = arg('--dest-token-account');
  if (dest) qs.set('destinationTokenAccount', new PublicKey(dest).toBase58());
  const url = `${BASE}/build?${qs}`;
  console.log(`GET ${url}`);
  const b = await getJson<BuildResponse>(url);
  if (b.error) throw new Error(`build error: ${b.error}`);

  console.log(`inAmount:         ${b.inAmount} lamports`);
  console.log(`outAmount:        ${b.outAmount} (raw base units; NOT scaled-UI adjusted)`);
  console.log(`otherAmountThr.:  ${b.otherAmountThreshold}`);
  console.log(`slippageBps:      ${b.slippageBps}`);
  console.log(`priceImpactPct:   ${b.priceImpactPct} (decimal ratio on /build)`);
  console.log(`txVersion:        ${b.transactionVersion ?? 0}`);
  console.log('routePlan:');
  printRoute(b.routePlan);
  const setupPrograms = new Set(b.setupInstructions.map((i) => i.programId));
  console.log(`setup programs:   ${[...setupPrograms].join(', ') || '(none)'}`);
  console.log(`ALTs:             ${Object.keys(b.addressesByLookupTableAddress ?? {}).length}`);

  if (!flag('--simulate')) return;

  if ((b.transactionVersion ?? 0) !== 0) throw new Error('simulate path only supports v0 (web3.js v1 cannot build v1 txs)');
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) throw new Error('--simulate needs RPC_URL');
  const connection = new Connection(rpcUrl, 'confirmed');

  const alts = Object.entries(b.addressesByLookupTableAddress ?? {}).map(
    ([key, addrs]) =>
      new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: {
          deactivationSlot: BigInt('18446744073709551615'),
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: addrs.map((a) => new PublicKey(a)),
        },
      }),
  );

  // Order mirrors jup-ag/docs swap/build/index.mdx:443-451,468 (setup, swap, cleanup, other; tip omitted).
  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT_FOR_SIM }),
    ...b.computeBudgetInstructions.map(toIx),
    ...b.setupInstructions.map(toIx),
    toIx(b.swapInstruction),
    ...(b.cleanupInstruction ? [toIx(b.cleanupInstruction)] : []),
    ...b.otherInstructions.map(toIx),
  ];

  // Blockhash: the 32-byte array from the response, base58-encoded via PublicKey; replaced by RPC anyway.
  const recentBlockhash = b.blockhashWithMetadata
    ? new PublicKey(Uint8Array.from(b.blockhashWithMetadata.blockhash)).toBase58()
    : (await connection.getLatestBlockhash()).blockhash;

  const message = new TransactionMessage({
    payerKey: new PublicKey(taker),
    recentBlockhash,
    instructions,
  }).compileToV0Message(alts);
  const tx = new VersionedTransaction(message); // UNSIGNED — never sent
  console.log(`unsigned tx size: ${tx.serialize().length} bytes (limit 1232)`);

  const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(`simulate err:     ${JSON.stringify(sim.value.err)}`);
  console.log(`unitsConsumed:    ${sim.value.unitsConsumed}`);
  for (const l of (sim.value.logs ?? []).slice(-25)) console.log(`  log: ${l}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
