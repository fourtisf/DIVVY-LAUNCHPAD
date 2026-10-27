import type { PrismaClient } from "@divvy/db";

export interface SignedTxEntry {
  purpose: string;
  signer: string;
  signature: string;
  coinId?: string | null;
  bundleId?: string | null;
  dryRun?: boolean;
}

/**
 * Every signed transaction is recorded with its purpose before it is sent (CLAUDE.md conventions). The
 * same transaction sent again (rebuilt with an unchanged blockhash, so the same signature) is recorded once.
 */
export const prismaTxLogger =
  (prisma: PrismaClient) =>
  async (e: SignedTxEntry): Promise<void> => {
    await prisma.signedTx.upsert({
      where: { signature: e.signature },
      create: { purpose: e.purpose, signer: e.signer, signature: e.signature, coinId: e.coinId ?? null, bundleId: e.bundleId ?? null, dryRun: e.dryRun ?? false },
      update: {},
    });
  };
