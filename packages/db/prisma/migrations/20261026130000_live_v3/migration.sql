-- AlterTable
ALTER TABLE "HolderBalance" ADD COLUMN     "excludedReason" TEXT;

-- AlterTable
ALTER TABLE "CoinStats" ADD COLUMN     "spark" JSONB NOT NULL DEFAULT '[]';

