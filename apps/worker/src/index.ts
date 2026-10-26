import { Cron } from "croner";
import { Redis } from "ioredis";
import { indexerHeartbeat, payoutsJob, reservedTickersJob, type JobContext } from "./jobs";
import { withLock } from "./lock";

const dryRun = process.env.PAYOUTS_DRY_RUN !== "false"; // dry-run unless explicitly turned off (CLAUDE.md rule 7)
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is required for job locking");
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
const ctx: JobContext = { dryRun, log };

const run = (name: string, ttlMs: number, fn: () => Promise<void>) => async () => {
  try {
    const r = await withLock(redis, name, ttlMs, async () => (await fn(), true));
    if (r === null) log(`${name}: another worker holds the lock, skipping`);
  } catch (e) {
    log(`${name}: failed`, { error: e instanceof Error ? e.message : String(e) });
  }
};

// Minute 0 of every hour, UTC. A round has 60 minutes plus 15 of grace (HANDOFF §3.3).
const jobs = [
  new Cron("0 * * * *", { timezone: "UTC", protect: true }, run("payouts", 75 * 60_000, () => payoutsJob(ctx))),
  new Cron("17 3 * * *", { timezone: "UTC", protect: true }, run("reserved-tickers", 30 * 60_000, () => reservedTickersJob(ctx))),
  new Cron("*/5 * * * *", { timezone: "UTC", protect: true }, run("indexer-heartbeat", 60_000, () => indexerHeartbeat(ctx))),
];

log("worker started", { dryRun, jobs: jobs.map((j) => j.getPattern()) });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    jobs.forEach((j) => j.stop());
    await redis.quit();
    process.exit(0);
  });
}
