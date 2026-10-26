import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { divvyPrisma?: PrismaClient };

/** One client per process (survives hot reload in dev). */
export const prisma: PrismaClient =
  globalForPrisma.divvyPrisma ?? new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.divvyPrisma = prisma;
