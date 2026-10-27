/**
 * seed-dividend-assets.ts — loads the dividend stocks into the live database from the output of
 * packages/solana/scripts/phase0/fetch-xstocks.ts --json, never from typed mints (CLAUDE.md rule 2,
 * docs/MAINNET_CHECKLIST.md "Dividend assets").
 *
 * A stock goes in only if fetch-xstocks reported no problem for it: a cited mint, Jupiter-verified,
 * Token-2022 on chain, the same decimals from Jupiter and the chain, not paused, no transfer hook,
 * new accounts not frozen. The chip art (monogram and colours) is the prototype's.
 *
 * DEFAULT IS DRY RUN: prints what it would write. `--write` upserts by symbol, and refuses to change
 * the mint of a stock that's already in the database.
 *
 * Usage (as divvy-worker, which can read worker.env):
 *   RPC_URL=... JUP_API_KEY=... pnpm --filter @divvy/solana exec tsx scripts/phase0/fetch-xstocks.ts --json > /tmp/xstocks.json
 *   node --env-file=/etc/divvy/worker.env --import tsx scripts/seed-dividend-assets.ts /tmp/xstocks.json [--write]
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@divvy/db";

// Prototype chip art (prototype/divvy-prototype.html; same values as apps/api/src/mock/data.ts).
const CHIP: Record<string, { name: string; mono: string; bg: string; fg: string; featured?: boolean }> = {
  NVDAx: { name: "Nvidia", mono: "NV", bg: "#76B900", fg: "#0D2200", featured: true },
  SPYx: { name: "S&P 500", mono: "SPY", bg: "#6D88FF", fg: "#0B1440", featured: true },
  TSLAx: { name: "Tesla", mono: "TS", bg: "#EF5A65", fg: "#3A0A10", featured: true },
  AAPLx: { name: "Apple", mono: "AP", bg: "#E1E5EA", fg: "#1B1F27", featured: true },
  QQQx: { name: "Nasdaq 100", mono: "QQQ", bg: "#3CCBEB", fg: "#06303A", featured: true },
  GOOGLx: { name: "Alphabet", mono: "GO", bg: "#FBC52C", fg: "#3A2A00" },
  AMZNx: { name: "Amazon", mono: "AM", bg: "#FFA552", fg: "#3A1E00" },
  MSTRx: { name: "Strategy", mono: "MS", bg: "#F7931A", fg: "#331A00", featured: true },
  COINx: { name: "Coinbase", mono: "CB", bg: "#3F70F7", fg: "#EEF3FF" },
  HOODx: { name: "Robinhood", mono: "HO", bg: "#C8F552", fg: "#223300" },
  CRCLx: { name: "Circle", mono: "CR", bg: "#8DB2FF", fg: "#0E1D45" },
};

interface Row {
  symbol: string;
  mint: string;
  cited: boolean;
  jupVerified?: boolean | null;
  jupDecimals?: number;
  rpcOwner?: string;
  rpcDecimals?: number;
  problems: string[];
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("usage: seed-dividend-assets.ts <fetch-xstocks.json> [--write]");
  const write = process.argv.includes("--write");
  const rows = JSON.parse(readFileSync(file, "utf8")) as Row[];

  const ok: (Row & { decimals: number })[] = [];
  for (const r of rows) {
    const why = [
      ...r.problems,
      ...(!r.cited ? ["not a cited mint"] : []),
      ...(r.jupVerified !== true ? ["not Jupiter-verified"] : []),
      ...(r.rpcOwner !== "Token-2022" ? ["not checked on chain as Token-2022 (was RPC_URL set?)"] : []),
      ...(r.rpcDecimals === undefined || r.rpcDecimals !== r.jupDecimals ? ["decimals unknown or different on chain"] : []),
      ...(!CHIP[r.symbol] ? ["no chip art"] : []),
    ];
    if (why.length) console.log(`skip ${r.symbol.padEnd(7)} ${r.mint}: ${why.join("; ")}`);
    else ok.push({ ...r, decimals: r.rpcDecimals! });
  }

  const prisma = new PrismaClient();
  try {
    for (const [i, r] of ok.entries()) {
      const c = CHIP[r.symbol]!;
      const existing = await prisma.dividendAsset.findUnique({ where: { symbol: r.symbol } });
      if (existing && existing.mint !== r.mint) throw new Error(`${r.symbol} is already in the database with mint ${existing.mint}, not ${r.mint}. Not changing it.`);
      const data = {
        symbol: r.symbol, name: c.name, kind: "stock" as const, mint: r.mint, decimals: r.decimals, tokenProgram: "token_2022" as const,
        mono: c.mono, chipBg: c.bg, chipFg: c.fg, featured: !!c.featured, sortOrder: i, source: "fetch-xstocks (Jupiter tokens v2 + RPC)", fetchedAt: new Date(),
      };
      console.log(`${write ? (existing ? "update" : "insert") : "would write"} ${r.symbol.padEnd(7)} ${r.mint} decimals ${r.decimals}`);
      if (write) await prisma.dividendAsset.upsert({ where: { symbol: r.symbol }, create: data, update: { ...data, enabled: existing?.enabled ?? true } });
    }
    console.log(write ? `\n${ok.length} stock(s) written.` : `\nDRY RUN — nothing written. Add --write to save ${ok.length} stock(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
