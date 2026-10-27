-- AlterTable
ALTER TABLE "PayoutTransfer" ADD COLUMN     "feeAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "rentLamports" BIGINT NOT NULL DEFAULT 0;
