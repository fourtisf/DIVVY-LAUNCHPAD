-- Trigram similarity for the anti-vamp name check.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "RoundStep" AS ENUM ('allocated', 'swapped', 'snapshotted', 'delivered');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('pending', 'sent', 'confirmed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('pending', 'confirmed', 'expired');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'resolved', 'dismissed');

-- AlterEnum
BEGIN;
CREATE TYPE "FeeClaimKind_new" AS ENUM ('cpmm_locked_lp', 'cpmm_creator');
ALTER TABLE "FeeClaim" ALTER COLUMN "kind" TYPE "FeeClaimKind_new" USING ("kind"::text::"FeeClaimKind_new");
ALTER TYPE "FeeClaimKind" RENAME TO "FeeClaimKind_old";
ALTER TYPE "FeeClaimKind_new" RENAME TO "FeeClaimKind";
DROP TYPE "public"."FeeClaimKind_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "FeeClaim" DROP CONSTRAINT "FeeClaim_roundId_fkey";

-- DropIndex
DROP INDEX "Coin_nameNorm_idx";

-- DropIndex
DROP INDEX "FeeClaim_sig_key";

-- AlterTable
ALTER TABLE "Coin" ADD COLUMN     "creatorWallet" TEXT NOT NULL,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "launchedAt" TIMESTAMP(3),
ADD COLUMN     "metadataUri" TEXT,
ADD COLUMN     "uploadId" TEXT,
ALTER COLUMN "mint" DROP NOT NULL,
ALTER COLUMN "poolState" DROP NOT NULL;

-- AlterTable
ALTER TABLE "FeeClaim" DROP COLUMN "creatorLamports",
DROP COLUMN "divvyLamports",
DROP COLUMN "holdersLamports",
DROP COLUMN "roundId",
ADD COLUMN     "memecoinAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "memecoinSwapSig" TEXT,
ALTER COLUMN "ts" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PayoutRound" ADD COLUMN     "step" "RoundStep" NOT NULL DEFAULT 'allocated',
ADD COLUMN     "swapBatchId" TEXT;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "creatorFee" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "platformFee" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "protocolFee" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "shareFee" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "venue" TEXT NOT NULL DEFAULT 'curve';

-- CreateTable
CREATE TABLE "CoinStats" (
    "coinId" TEXT NOT NULL,
    "priceSol" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "marketCapUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "athUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "change24hPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volume24hLamports" BIGINT NOT NULL DEFAULT 0,
    "volume24hUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holders" INTEGER NOT NULL DEFAULT 0,
    "progressBps" INTEGER NOT NULL DEFAULT 0,
    "realBase" BIGINT NOT NULL DEFAULT 0,
    "realQuote" BIGINT NOT NULL DEFAULT 0,
    "paidAsset" BIGINT NOT NULL DEFAULT 0,
    "paidUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paid24hAsset" BIGINT NOT NULL DEFAULT 0,
    "paid24hUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastTradeAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinStats_pkey" PRIMARY KEY ("coinId")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "imagePhash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultClaim" (
    "id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "sig" TEXT,
    "lamports" BIGINT NOT NULL,
    "fromSlot" BIGINT NOT NULL,
    "toSlot" BIGINT NOT NULL,
    "unattributedLamports" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAllocation" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "vaultClaimId" TEXT,
    "feeClaimId" TEXT,
    "lamports" BIGINT NOT NULL,
    "holdersLamports" BIGINT NOT NULL,
    "creatorLamports" BIGINT NOT NULL DEFAULT 0,
    "divvyLamports" BIGINT NOT NULL,
    "roundId" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapBatch" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "status" "SwapStatus" NOT NULL DEFAULT 'pending',
    "lamportsIn" BIGINT NOT NULL,
    "assetOut" BIGINT NOT NULL DEFAULT 0,
    "minOut" BIGINT NOT NULL DEFAULT 0,
    "priceImpactBps" INTEGER NOT NULL DEFAULT 0,
    "sig" TEXT,
    "bundleId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwapBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credit" (
    "wallet" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credit_pkey" PRIMARY KEY ("wallet","assetId")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'pending',
    "sig" TEXT NOT NULL,
    "lastValidBlockHeight" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "name" TEXT NOT NULL,
    "lastSignature" TEXT,
    "lastSlot" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "reporterUserId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "adminWallet" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CoinStats_marketCapUsd_idx" ON "CoinStats"("marketCapUsd");

-- CreateIndex
CREATE INDEX "CoinStats_volume24hUsd_idx" ON "CoinStats"("volume24hUsd");

-- CreateIndex
CREATE INDEX "CoinStats_paid24hUsd_idx" ON "CoinStats"("paid24hUsd");

-- CreateIndex
CREATE INDEX "Upload_sha256_idx" ON "Upload"("sha256");

-- CreateIndex
CREATE INDEX "Upload_createdAt_idx" ON "Upload"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VaultClaim_sig_key" ON "VaultClaim"("sig");

-- CreateIndex
CREATE UNIQUE INDEX "VaultClaim_hour_dryRun_key" ON "VaultClaim"("hour", "dryRun");

-- CreateIndex
CREATE INDEX "FeeAllocation_coinId_roundId_idx" ON "FeeAllocation"("coinId", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeAllocation_vaultClaimId_coinId_key" ON "FeeAllocation"("vaultClaimId", "coinId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeAllocation_feeClaimId_coinId_key" ON "FeeAllocation"("feeClaimId", "coinId");

-- CreateIndex
CREATE UNIQUE INDEX "SwapBatch_assetId_hour_dryRun_key" ON "SwapBatch"("assetId", "hour", "dryRun");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_sig_key" ON "Claim"("sig");

-- CreateIndex
CREATE INDEX "Claim_wallet_status_idx" ON "Claim"("wallet", "status");

-- CreateIndex
CREATE INDEX "Claim_status_createdAt_idx" ON "Claim"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_coinId_idx" ON "Report"("coinId");

-- CreateIndex
CREATE INDEX "AdminAction_createdAt_idx" ON "AdminAction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_uploadId_key" ON "Coin"("uploadId");

-- CreateIndex
CREATE INDEX "Coin_nameNorm_trgm" ON "Coin" USING GIN ("nameNorm" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Coin_creatorWallet_idx" ON "Coin"("creatorWallet");

-- CreateIndex
CREATE UNIQUE INDEX "FeeClaim_sig_coinId_kind_key" ON "FeeClaim"("sig", "coinId", "kind");

-- CreateIndex
CREATE INDEX "Trade_slot_idx" ON "Trade"("slot");

-- AddForeignKey
ALTER TABLE "Coin" ADD CONSTRAINT "Coin_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinStats" ADD CONSTRAINT "CoinStats_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAllocation" ADD CONSTRAINT "FeeAllocation_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAllocation" ADD CONSTRAINT "FeeAllocation_vaultClaimId_fkey" FOREIGN KEY ("vaultClaimId") REFERENCES "VaultClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAllocation" ADD CONSTRAINT "FeeAllocation_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "PayoutRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapBatch" ADD CONSTRAINT "SwapBatch_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "DividendAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRound" ADD CONSTRAINT "PayoutRound_swapBatchId_fkey" FOREIGN KEY ("swapBatchId") REFERENCES "SwapBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "DividendAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "DividendAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

