-- Owner decision 2026-10-27: coins may share a ticker, a name or an X account.
-- DropIndex
DROP INDEX "Coin_tickerNorm_key";

-- DropIndex
DROP INDEX "Coin_creatorXUserId_key";

-- CreateIndex
CREATE INDEX "Coin_tickerNorm_idx" ON "Coin"("tickerNorm");

-- CreateIndex
CREATE INDEX "Coin_creatorXUserId_idx" ON "Coin"("creatorXUserId");
