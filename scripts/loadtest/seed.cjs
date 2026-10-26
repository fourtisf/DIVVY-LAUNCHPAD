/* eslint-disable @typescript-eslint/no-require-imports -- a plain CommonJS script run with node */
// Seeds 1,000 visible coins with stats into LOAD_DATABASE_URL (a throwaway database: it is truncated first).
// Run from packages/db so @prisma/client resolves: NODE_PATH=$PWD/node_modules:../solana/node_modules LOAD_DATABASE_URL=... node ../../scripts/loadtest/seed.cjs
const { PrismaClient } = require("@prisma/client");
const { Keypair } = require("@solana/web3.js");
if (!/_load\b|_load\?|load/.test(process.env.LOAD_DATABASE_URL ?? "")) throw new Error("LOAD_DATABASE_URL must point at a throwaway database whose name contains \"load\"");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.LOAD_DATABASE_URL } } });
(async () => {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
  const assets = [];
  for (const sym of ["NVDAx", "SPYx", "TSLAx", "AAPLx"]) assets.push(await prisma.dividendAsset.create({ data: { symbol: sym, name: sym, kind: "stock", mint: Keypair.generate().publicKey.toBase58(), decimals: 8, tokenProgram: "token_2022", mono: sym.slice(0, 2), chipBg: "#000", chipFg: "#fff", source: "load", fetchedAt: new Date() } }));
  const user = await prisma.user.create({ data: { wallet: Keypair.generate().publicKey.toBase58() } });
  const now = Date.now();
  for (let i = 0; i < 1000; i++) {
    const t = "LD" + [0, 1, 2].map((k) => String.fromCharCode(65 + Math.floor(i / 26 ** k) % 26)).join("");
    await prisma.coin.create({ data: {
      mint: Keypair.generate().publicKey.toBase58(), ticker: t, tickerNorm: t, name: "Load " + i, nameNorm: "load" + i, imageUrl: "/x.webp", imageSha256: "s" + i, imagePhash: "0",
      dividendAssetId: assets[i % 4].id, creatorUserId: user.id, creatorWallet: user.wallet, poolState: Keypair.generate().publicKey.toBase58(), status: i % 10 === 0 ? "graduated" : "live", launchedAt: new Date(now - i * 60000),
      stats: { create: { priceSol: (0.00000003 + i * 1e-9).toFixed(12), marketCapUsd: 5000 + i * 10, volume24hUsd: i * 7, holders: i, paid24hUsd: i % 50, paidUsd: i, progressBps: i * 9 % 10000, spark: Array.from({ length: 28 }, (_, k) => 5000 + k * i) } },
    } });
  }
  console.log("seeded", await prisma.coin.count());
  await prisma.$disconnect();
})();
