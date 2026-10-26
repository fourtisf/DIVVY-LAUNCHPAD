/**
 * Worker jobs (HANDOFF §8). Phase 1 ships the schedule, locking and dry-run switch; the bodies arrive
 * in later phases and say so loudly instead of pretending to work.
 */
export interface JobContext {
  dryRun: boolean;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Top of the hour (UTC) a run belongs to. Rounds are unique per coin + hour + dryRun. */
export const roundHour = (now = new Date()): Date => new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);

export async function payoutsJob(ctx: JobContext, now = new Date()): Promise<void> {
  ctx.log("payouts: round start", { hour: roundHour(now).toISOString(), dryRun: ctx.dryRun });
  // Phase 4: claim fees → split → threshold → Jupiter swap → snapshot → entitlements → deliver → persist.
  ctx.log("payouts: dividend engine not built yet (Phase 4); nothing claimed, swapped or sent");
}

export async function reservedTickersJob(ctx: JobContext): Promise<void> {
  // Phase 2: refresh ReservedTicker from DexScreener / Jupiter top tokens by volume.
  ctx.log("reserved-tickers: refresh not built yet (Phase 2)");
}

export async function indexerHeartbeat(ctx: JobContext): Promise<void> {
  // Phase 3: Helius webhook / gRPC subscription on LaunchLab filtered to Divvy's PlatformConfig.
  ctx.log("indexer: not built yet (Phase 3)");
}
