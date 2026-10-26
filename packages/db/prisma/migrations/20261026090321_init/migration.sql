-- CreateEnum
CREATE TYPE "CoinStatus" AS ENUM ('pending', 'live', 'graduated', 'failed');

-- CreateEnum
CREATE TYPE "LaunchStep" AS ENUM ('checking', 'bundling', 'landed', 'indexed', 'failed');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "CandleTf" AS ENUM ('1m', '5m', '1h', '1d');

-- CreateEnum
CREATE TYPE "FeeClaimKind" AS ENUM ('curve_platform', 'cpmm_locked_lp');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('ok', 'carried', 'late', 'failed');

-- CreateEnum
CREATE TYPE "PayoutItemStatus" AS ENUM ('credited', 'sent', 'claimed');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('stock', 'crypto');

-- CreateEnum
CREATE TYPE "TokenProgram" AS ENUM ('spl-token', 'token-2022');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "xUserId" TEXT,
    "xHandle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DividendAsset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "mint" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "tokenProgram" "TokenProgram" NOT NULL,
    "logoUrl" TEXT,
    "mono" TEXT NOT NULL,
    "chipBg" TEXT NOT NULL,
    "chipFg" TEXT NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DividendAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coin" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "tickerNorm" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNorm" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL,
    "imageSha256" TEXT NOT NULL,
    "imagePhash" TEXT NOT NULL,
    "dividendAssetId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "creatorXUserId" TEXT,
    "poolState" TEXT NOT NULL,
    "cpmmPool" TEXT,
    "status" "CoinStatus" NOT NULL DEFAULT 'pending',
    "createdSig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "graduatedAt" TIMESTAMP(3),
    "links" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Coin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Launch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coinId" TEXT,
    "step" "LaunchStep" NOT NULL DEFAULT 'checking',
    "mintPubkey" TEXT NOT NULL,
    "bundleId" TEXT,
    "signature" TEXT,
    "error" JSONB,
    "request" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Launch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" BIGSERIAL NOT NULL,
    "sig" TEXT NOT NULL,
    "ix" INTEGER NOT NULL,
    "coinId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "solAmount" BIGINT NOT NULL,
    "tokenAmount" BIGINT NOT NULL,
    "wallet" TEXT NOT NULL,
    "priceSol" DECIMAL(38,18) NOT NULL,
    "slot" BIGINT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candle" (
    "coinId" TEXT NOT NULL,
    "tf" "CandleTf" NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "o" DECIMAL(38,18) NOT NULL,
    "h" DECIMAL(38,18) NOT NULL,
    "l" DECIMAL(38,18) NOT NULL,
    "c" DECIMAL(38,18) NOT NULL,
    "volSol" BIGINT NOT NULL,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("coinId","tf","ts")
);

-- CreateTable
CREATE TABLE "FeeClaim" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "kind" "FeeClaimKind" NOT NULL,
    "sig" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "holdersLamports" BIGINT NOT NULL,
    "creatorLamports" BIGINT NOT NULL,
    "divvyLamports" BIGINT NOT NULL,
    "roundId" TEXT,
    "ts" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRound" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" "RoundStatus" NOT NULL,
    "solIn" BIGINT NOT NULL DEFAULT 0,
    "carriedInLamports" BIGINT NOT NULL DEFAULT 0,
    "carriedOutLamports" BIGINT NOT NULL DEFAULT 0,
    "assetOut" BIGINT NOT NULL DEFAULT 0,
    "dustCarried" BIGINT NOT NULL DEFAULT 0,
    "priceUsd" DECIMAL(38,18),
    "swapSig" TEXT,
    "holdersPaid" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "amountAsset" BIGINT NOT NULL,
    "status" "PayoutItemStatus" NOT NULL,
    "sendSig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolderBalance" (
    "coinId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "balance" BIGINT NOT NULL,
    "snapshotHour" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolderBalance_pkey" PRIMARY KEY ("coinId","snapshotHour","wallet")
);

-- CreateTable
CREATE TABLE "ReservedTicker" (
    "tickerNorm" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservedTicker_pkey" PRIMARY KEY ("tickerNorm")
);

-- CreateTable
CREATE TABLE "SignedTx" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "signer" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "coinId" TEXT,
    "bundleId" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignedTx_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_wallet_key" ON "User"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "User_xUserId_key" ON "User"("xUserId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DividendAsset_symbol_key" ON "DividendAsset"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "DividendAsset_mint_key" ON "DividendAsset"("mint");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_mint_key" ON "Coin"("mint");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_tickerNorm_key" ON "Coin"("tickerNorm");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_imageSha256_key" ON "Coin"("imageSha256");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_creatorXUserId_key" ON "Coin"("creatorXUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_poolState_key" ON "Coin"("poolState");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_cpmmPool_key" ON "Coin"("cpmmPool");

-- CreateIndex
CREATE INDEX "Coin_nameNorm_idx" ON "Coin"("nameNorm");

-- CreateIndex
CREATE INDEX "Coin_status_createdAt_idx" ON "Coin"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Coin_dividendAssetId_idx" ON "Coin"("dividendAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "Launch_coinId_key" ON "Launch"("coinId");

-- CreateIndex
CREATE UNIQUE INDEX "Launch_mintPubkey_key" ON "Launch"("mintPubkey");

-- CreateIndex
CREATE INDEX "Launch_userId_createdAt_idx" ON "Launch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Launch_createdAt_idx" ON "Launch"("createdAt");

-- CreateIndex
CREATE INDEX "Trade_coinId_ts_idx" ON "Trade"("coinId", "ts");

-- CreateIndex
CREATE INDEX "Trade_wallet_ts_idx" ON "Trade"("wallet", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_sig_ix_key" ON "Trade"("sig", "ix");

-- CreateIndex
CREATE UNIQUE INDEX "FeeClaim_sig_key" ON "FeeClaim"("sig");

-- CreateIndex
CREATE INDEX "FeeClaim_coinId_ts_idx" ON "FeeClaim"("coinId", "ts");

-- CreateIndex
CREATE INDEX "PayoutRound_hour_idx" ON "PayoutRound"("hour");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutRound_coinId_hour_dryRun_key" ON "PayoutRound"("coinId", "hour", "dryRun");

-- CreateIndex
CREATE INDEX "PayoutItem_wallet_status_idx" ON "PayoutItem"("wallet", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_roundId_wallet_key" ON "PayoutItem"("roundId", "wallet");

-- CreateIndex
CREATE INDEX "HolderBalance_wallet_idx" ON "HolderBalance"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "SignedTx_signature_key" ON "SignedTx"("signature");

-- CreateIndex
CREATE INDEX "SignedTx_purpose_createdAt_idx" ON "SignedTx"("purpose", "createdAt");

-- CreateIndex
CREATE INDEX "SignedTx_coinId_idx" ON "SignedTx"("coinId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coin" ADD CONSTRAINT "Coin_dividendAssetId_fkey" FOREIGN KEY ("dividendAssetId") REFERENCES "DividendAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coin" ADD CONSTRAINT "Coin_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candle" ADD CONSTRAINT "Candle_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeClaim" ADD CONSTRAINT "FeeClaim_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeClaim" ADD CONSTRAINT "FeeClaim_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PayoutRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRound" ADD CONSTRAINT "PayoutRound_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PayoutRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolderBalance" ADD CONSTRAINT "HolderBalance_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
