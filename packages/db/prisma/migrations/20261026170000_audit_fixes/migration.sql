-- AlterTable
ALTER TABLE "VaultClaim" ADD COLUMN     "fromTradeId" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "toTradeId" BIGINT;

-- CreateIndex
CREATE INDEX "Trade_coinId_id_idx" ON "Trade"("coinId", "id");

