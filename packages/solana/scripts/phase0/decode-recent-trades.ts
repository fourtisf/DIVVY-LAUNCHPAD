/**
 * decode-recent-trades.ts — READ-ONLY. Never signs, never sends.
 *
 * Runs the indexer's own decoders over recent mainnet transactions, so the event layouts Divvy relies
 * on (docs/VERIFIED.md items 13 and 14) are checked against real data before mainnet:
 *   - LaunchLab TradeEvent / PoolCreateEvent (emit_cpi!) via parseLaunchLabTransaction
 *   - CPMM SwapEvent (emit!) via parseCpmmSwaps
 * Every TradeEvent goes through decodeTradeEvent's sanity checks; a failure means the on-chain layout
 * changed and the indexer would halt.
 *
 * Usage:
 *   RPC_URL=https://... npx tsx decode-recent-trades.ts                     # latest LaunchLab transactions
 *   RPC_URL=... npx tsx decode-recent-trades.ts --address <platformConfig>   # a platform's transactions (e.g. StonkFun's)
 *   RPC_URL=... npx tsx decode-recent-trades.ts --cpmm <poolId>              # a graduated pool's swaps
 *   Options: --limit 40 (signatures to read)
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { EventLayoutError, parseCpmmSwaps, parseLaunchLabTransaction, programs } from "../../src/live";

/**
 * Raw getTransaction, to see what web3.js 1.x can't read: it only accepts versions "legacy" and 0, and
 * the RPC answers -32015 (UnsupportedTransactionVersion) for anything newer.
 */
async function rawTransaction(rpc: string, signature: string, maxSupportedTransactionVersion: number): Promise<{ result?: Record<string, unknown> | null; error?: { code: number; message: string } }> {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion }] }),
  });
  return (await r.json()) as { result?: Record<string, unknown> | null; error?: { code: number; message: string } };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rpc = process.env.RPC_URL;
  if (!rpc) throw new Error("set RPC_URL (any mainnet RPC; read-only)");
  const conn = new Connection(rpc, "confirmed");
  const P = programs("mainnet-beta");
  const cpmmPool = arg("--cpmm");
  const address = new PublicKey(cpmmPool ?? arg("--address") ?? P.launchLab.toBase58());
  const limit = Number(arg("--limit") ?? 40);

  const sigs = await conn.getSignaturesForAddress(address, { limit }, "confirmed");
  let trades = 0;
  let creates = 0;
  let migrations = 0;
  let swaps = 0;
  let layoutErrors = 0;
  let unsupportedVersion = 0;
  let rpcErrors = 0;
  const versions: Record<string, number> = {};
  for (const s of sigs) {
    if (s.err) continue;
    let tx;
    try {
      tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/-32015|not supported/i.test(msg)) {
        rpcErrors++;
        if (rpcErrors <= 3) console.log(`${s.signature}: RPC error: ${msg.slice(0, 200)}`);
        continue;
      }
      unsupportedVersion++;
      // What is it? Ask again for version 1 and show its shape (first three only).
      if (unsupportedVersion <= 3) {
        console.log(`${s.signature}: ${msg.slice(0, 200)}`);
        const raw: Awaited<ReturnType<typeof rawTransaction>> = await rawTransaction(rpc, s.signature, 1).catch((err) => ({ error: { code: 0, message: String(err) } }));
        if (raw.error) console.log(`  as version 1: error ${raw.error.code} ${raw.error.message.slice(0, 200)}`);
        else if (raw.result) {
          const t = raw.result as { version?: unknown; transaction?: { message?: Record<string, unknown> }; meta?: Record<string, unknown> };
          const m = t.transaction?.message ?? {};
          console.log(`  as version 1: version ${JSON.stringify(t.version)}; message keys ${Object.keys(m).join(",")}; meta keys ${Object.keys(t.meta ?? {}).join(",")}`);
          console.log(`  launchlab in accountKeys: ${JSON.stringify(m.accountKeys ?? null).includes(P.launchLab.toBase58())}; inner instruction groups: ${Array.isArray(t.meta?.innerInstructions) ? (t.meta!.innerInstructions as unknown[]).length : "none"}`);
        }
      }
      continue;
    }
    if (!tx) continue;
    versions[String(tx.version ?? "legacy")] = (versions[String(tx.version ?? "legacy")] ?? 0) + 1;
    if (cpmmPool) {
      for (const sw of parseCpmmSwaps(tx, P.cpmm)) {
        if (!sw.event.poolId.equals(address)) continue;
        swaps++;
        const e = sw.event;
        console.log(`${s.signature.slice(0, 12)}… swap in ${e.inputAmount} ${e.inputMint.toBase58().slice(0, 6)}… out ${e.outputAmount} ${e.outputMint.toBase58().slice(0, 6)}… tradeFee ${e.tradeFee} creatorFee ${e.creatorFee}`);
      }
      continue;
    }
    try {
      const r = parseLaunchLabTransaction(tx, P.launchLab, P.cpmm);
      for (const t of r.trades) {
        trades++;
        const e = t.event;
        console.log(
          `${s.signature.slice(0, 12)}… ${e.side} pool ${e.poolState.toBase58().slice(0, 6)}… in ${e.amountIn} out ${e.amountOut} fees protocol ${e.protocolFee} platform ${e.platformFee} creator ${e.creatorFee} share ${e.shareFee} status ${e.poolStatus}`,
        );
      }
      for (const c of r.poolCreates) {
        creates++;
        console.log(`${s.signature.slice(0, 12)}… create pool ${c.poolState.toBase58()} creator ${c.creator.toBase58()}`);
      }
      for (const m of r.cpmmPools) {
        migrations++;
        console.log(`${s.signature.slice(0, 12)}… migration → CPMM pool ${m.lpPool.toBase58()}`);
      }
    } catch (e) {
      if (!(e instanceof EventLayoutError)) throw e;
      layoutErrors++;
      console.log(`${s.signature}: layout mismatch: ${e.message}`);
    }
  }
  console.log(JSON.stringify({ address: address.toBase58(), read: sigs.length, versions, unsupportedVersion, rpcErrors, trades, creates, migrations, swaps, layoutErrors }));
  if (layoutErrors) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
