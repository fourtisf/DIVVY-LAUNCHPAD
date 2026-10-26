import type { PrismaClient } from "@divvy/db";

export interface LaunchSettings {
  launchesOpen: boolean;
  reason: string | null;
}

const KEY = "launches";

export async function getLaunchSettings(prisma: PrismaClient): Promise<LaunchSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<LaunchSettings>;
  return { launchesOpen: v.launchesOpen ?? true, reason: v.reason ?? null };
}

export async function setLaunchSettings(prisma: PrismaClient, s: LaunchSettings): Promise<void> {
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: { ...s } }, update: { value: { ...s } } });
}
