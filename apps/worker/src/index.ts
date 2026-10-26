/**
 * Divvy worker: launch pipeline, claim builder, indexer, hourly dividend engine and ops jobs.
 * WORKER_ROLES picks which parts run in this process (all by default).
 * Payouts are dry-run unless PAYOUTS_DRY_RUN=false (CLAUDE.md rule 7), and nothing is ever sent on
 * mainnet unless DIVVY_MAINNET_ENABLED=true (set only after the audit sign-off).
 */
import { Cron } from "croner";
import { Queue, Worker } from "bullmq";
import { bullConnection } from "@divvy/server";
import { QUEUES, type ClaimJob, type ClaimJobResult, type LaunchJob } from "@divvy/shared";
import { assertClusterMatchesRpc } from "@divvy/solana/live";
import { buildClaim, reconcileClaims } from "./claims";
import { createWorkerDeps, jsonLog } from "./deps";
import { loadWorkerEnv } from "./env";
import { Indexer } from "./indexer";
import { processLaunch, reconcileLaunches } from "./launch";
import { withLock } from "./lock";
import { pricesJob, reservedTickersJob, statusJob } from "./ops";
import { liveChain } from "./payouts/chain";
import { reconcileTransfers } from "./payouts/deliver";
import { runPayouts, topOfHour } from "./payouts/engine";
import { preSnapshotJob } from "./payouts/presnapshot";
import { refreshMarketStats } from "./stats";

const env = loadWorkerEnv();
const d = createWorkerDeps(env);
// The mainnet gate trusts SOLANA_CLUSTER; make sure the RPC agrees before anything starts.
await assertClusterMatchesRpc(d.conn, d.sol.cluster);
const roles = env.WORKER_ROLES;
const stops: (() => unknown)[] = [];
const crons: Cron[] = [];

/** Jobs in flight, so a shutdown can let them finish (a payout run mid-send shouldn't be cut). */
const running = new Set<Promise<unknown>>();
let stopping = false;

const guarded = (name: string, ttlMs: number, fn: () => Promise<unknown>) => async () => {
  if (stopping) return;
  const job = (async () => {
    try {
      const r = await withLock(d.redis, name, ttlMs, async () => (await fn(), true));
      if (r === null) jsonLog(`${name}: another worker holds the lock, skipping`);
    } catch (e) {
      jsonLog(`${name}: failed`, { error: e instanceof Error ? e.message : String(e) });
    }
  })();
  running.add(job);
  await job;
  running.delete(job);
};
const every = (pattern: string, name: string, ttlMs: number, fn: () => Promise<unknown>) =>
  crons.push(new Cron(pattern, { timezone: "UTC", protect: true }, guarded(name, ttlMs, fn)));

if (roles.has("launch")) {
  const queue = new Queue<LaunchJob>(QUEUES.launch, { connection: bullConnection(env.REDIS_URL) });
  // One create per launch at a time, even if a job is re-queued while the first is still running.
  const worker = new Worker<LaunchJob>(QUEUES.launch, async (job) => withLock(d.redis, `launch:${job.data.launchId}`, 10 * 60_000, () => processLaunch(d, job.data.launchId)), {
    connection: bullConnection(env.REDIS_URL),
    concurrency: 4,
  });
  stops.push(() => worker.close(), () => queue.close());
  every("* * * * *", "launch-reconcile", 55_000, () =>
    reconcileLaunches(d, async (id) => void (await queue.add("create", { launchId: id }, { jobId: `${id}-requeue-${Math.floor(Date.now() / 600_000)}`, removeOnComplete: 1000, removeOnFail: 1000 }))),
  );
}

if (roles.has("claims")) {
  const worker = new Worker<ClaimJob, ClaimJobResult>(QUEUES.claims, (job) => buildClaim(d, job.data), { connection: bullConnection(env.REDIS_URL), concurrency: 8 });
  stops.push(() => worker.close());
  every("* * * * *", "claims-reconcile", 55_000, () => reconcileClaims(d));
}

if (roles.has("indexer")) {
  const indexer = new Indexer(d);
  stops.push(indexer.start());
  every("* * * * *", "market-stats", 55_000, async () => {
    const { migrating } = await refreshMarketStats(d);
    await indexer.checkMigrations(migrating);
  });
}

if (roles.has("payouts")) {
  const chain = liveChain(d);
  // Minute 0 starts the hour's run; every 10 minutes resumes anything unfinished (each step is idempotent).
  every("*/10 * * * *", "payouts", 15 * 60_000, async () => {
    const hour = topOfHour();
    // Earlier hours with unfinished rounds (up to a day back) are finished first, without new rounds.
    const stuck = await d.prisma.payoutRound.findMany({
      where: { dryRun: d.params.dryRun, step: { not: "delivered" }, hour: { lt: hour, gte: new Date(hour.getTime() - 24 * 3_600_000) } },
      distinct: ["hour"],
      orderBy: { hour: "asc" },
      select: { hour: true },
    });
    for (const s of stuck) {
      jsonLog("payouts: resuming an earlier hour", { hour: s.hour });
      await runPayouts(d, chain, s.hour, d.params.dryRun, undefined, { resumeOnly: true }).catch((e) => jsonLog("payouts: resume failed", { hour: s.hour, error: e instanceof Error ? e.message : String(e) }));
    }
    const summary = await runPayouts(d, chain, hour, d.params.dryRun);
    jsonLog("payouts: run", { ...summary });
  });
  // The random mid-hour holder snapshot (payouts/presnapshot.ts).
  every("* * * * *", "presnapshot", 30 * 60_000, () => preSnapshotJob(d, chain));
  every("* * * * *", "transfers-reconcile", 55_000, () => reconcileTransfers(d));
}

if (roles.has("prices")) every("* * * * *", "prices", 55_000, () => pricesJob(d));
if (roles.has("status")) every("* * * * *", "status", 55_000, () => statusJob(d));
if (roles.has("reserved")) every("17 3 * * *", "reserved-tickers", 30 * 60_000, () => reservedTickersJob(d));

jsonLog("worker started", {
  roles: [...roles],
  cluster: d.sol.cluster,
  mainnetEnabled: d.sol.mainnetEnabled,
  payoutsDryRun: d.params.dryRun,
  delivery: d.params.delivery,
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    crons.forEach((c) => c.stop());
    // Let running jobs finish (PM2 kill_timeout must be longer than this).
    await Promise.race([Promise.allSettled([...running]), new Promise((r) => setTimeout(r, 120_000))]);
    await Promise.allSettled(stops.map((s) => s()));
    await d.close();
    process.exit(0);
  });
}
