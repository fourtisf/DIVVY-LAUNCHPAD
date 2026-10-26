-- CreateEnum
CREATE TYPE "CreatorTransferStatus" AS ENUM ('sent', 'landed');

-- AlterTable
ALTER TABLE "Coin" ADD COLUMN     "feeKeyMint" TEXT;

-- AlterTable
ALTER TABLE "FeeAllocation" ADD COLUMN     "creatorTransferId" TEXT;

-- CreateTable
CREATE TABLE "CreatorTransfer" (
    "id" TEXT NOT NULL,
    "coinId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "sig" TEXT NOT NULL,
    "status" "CreatorTransferStatus" NOT NULL DEFAULT 'sent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorTransfer_sig_key" ON "CreatorTransfer"("sig");

-- CreateIndex
CREATE INDEX "CreatorTransfer_coinId_createdAt_idx" ON "CreatorTransfer"("coinId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Coin_feeKeyMint_key" ON "Coin"("feeKeyMint");

-- CreateIndex
CREATE INDEX "FeeAllocation_coinId_creatorTransferId_idx" ON "FeeAllocation"("coinId", "creatorTransferId");

-- AddForeignKey
ALTER TABLE "FeeAllocation" ADD CONSTRAINT "FeeAllocation_creatorTransferId_fkey" FOREIGN KEY ("creatorTransferId") REFERENCES "CreatorTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTransfer" ADD CONSTRAINT "CreatorTransfer_coinId_fkey" FOREIGN KEY ("coinId") REFERENCES "Coin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

