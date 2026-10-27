-- DropIndex
DROP INDEX "Coin_imageSha256_key";

-- CreateTable
CREATE TABLE "LaunchFee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sig" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "launchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LaunchFee_sig_key" ON "LaunchFee"("sig");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchFee_launchId_key" ON "LaunchFee"("launchId");

-- CreateIndex
CREATE INDEX "LaunchFee_userId_launchId_idx" ON "LaunchFee"("userId", "launchId");

-- CreateIndex
CREATE INDEX "Coin_imageSha256_idx" ON "Coin"("imageSha256");

-- AddForeignKey
ALTER TABLE "LaunchFee" ADD CONSTRAINT "LaunchFee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchFee" ADD CONSTRAINT "LaunchFee_launchId_fkey" FOREIGN KEY ("launchId") REFERENCES "Launch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

