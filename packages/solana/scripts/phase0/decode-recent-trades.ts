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
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx) continue;
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
  console.log(JSON.stringify({ address: address.toBase58(), read: sigs.length, trades, creates, migrations, swaps, layoutErrors }));
  if (layoutErrors) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
