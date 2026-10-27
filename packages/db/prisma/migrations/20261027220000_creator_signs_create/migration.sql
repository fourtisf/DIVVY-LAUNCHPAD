-- Owner decision 2026-10-27: the creator's wallet pays for and signs its coin's create.
-- AlterEnum
ALTER TYPE "LaunchStep" ADD VALUE 'signing';

-- AlterTable
ALTER TABLE "Launch" ADD COLUMN     "creatorSigned" TEXT,
ADD COLUMN     "feeLamports" BIGINT,
ADD COLUMN     "signRefused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unsignedTx" TEXT;
