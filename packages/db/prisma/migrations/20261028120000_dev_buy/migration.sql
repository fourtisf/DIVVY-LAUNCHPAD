-- Owner decision 2026-10-28: a creator may buy their own coin inside its create (a dev buy).
-- AlterTable
ALTER TABLE "Coin" ADD COLUMN     "devBuyLamports" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "devBuyTokens" BIGINT NOT NULL DEFAULT 0;
