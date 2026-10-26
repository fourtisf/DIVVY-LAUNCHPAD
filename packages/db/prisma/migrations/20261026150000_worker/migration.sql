-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('pending', 'confirmed', 'expired');

-- AlterTable
ALTER TABLE "Launch" ADD COLUMN     "lastValidBlockHeight" BIGINT;

-- CreateTable
CREATE TABLE "PayoutTransfer" (
    "id" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAta" BOOLEAN NOT NULL DEFAULT false,
    "status" "TransferStatus" NOT NULL DEFAULT 'pending',
    "lastValidBlockHeight" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutTransfer_status_createdAt_idx" ON "PayoutTransfer"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PayoutTransfer_wallet_assetId_idx" ON "PayoutTransfer"("wallet", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutTransfer_sig_wallet_key" ON "PayoutTransfer"("sig", "wallet");

-- AddForeignKey
ALTER TABLE "PayoutTransfer" ADD CONSTRAINT "PayoutTransfer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "DividendAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

