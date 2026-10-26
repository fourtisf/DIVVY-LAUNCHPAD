/**
 * PM2 process file for the Divvy VPS. See deploy/setup-vps.md (one-time setup) and docs/RUNBOOK.md (deploys).
 *
 * Run PM2 as the `divvy` user, from a login shell:
 *   sudo -iu divvy
 *   pm2 start  /srv/divvy/current/deploy/ecosystem.config.cjs                  # first start
 *   pm2 reload /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-web,divvy-api --update-env
 *   pm2 restart /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-worker --update-env
 *   pm2 save                                                                    # what systemd resurrects at boot
 *
 * Environment. Every app is started as `node --env-file=/etc/divvy/divvy.env <script>` (Node 22), so:
 *   - secrets live only in /etc/divvy/divvy.env (chmod 600, owner divvy), never here or in the repo;
 *   - Node reads the file inside the process, so the values never land in PM2's dump (~/.pm2/dump.pm2)
 *     or in `pm2 env` output;
 *   - a missing file is a hard start failure (--env-file, not --env-file-if-exists);
 *   - editing the file takes effect on the next reload/restart. NEXT_PUBLIC_* values are the exception:
 *     Next.js inlines them at build time, so changing one needs a rebuild (RUNBOOK "Deploy").
 * PM2 copies the calling shell's environment into the apps, and a variable that is already set beats the
 * env file. `filter_env` drops shell variables whose names contain any of the strings below, so a
 * DATABASE_URL exported for a restore drill can't follow `pm2 reload --update-env` into production.
 * (`filter_env: true` is a no-op in PM2 7.1: it tests `.length`.) Keep the list in step with .env.example.
 * Values set in `env` below are applied after the filter and override the env file.
 *
 * Paths can be overridden when this file is evaluated (staging boxes, local checks):
 *   DIVVY_ROOT (default /srv/divvy/current), DIVVY_ENV_FILE (/etc/divvy/divvy.env), DIVVY_LOG_DIR (/var/log/divvy).
 * PM2 resolves them at `pm2 start/reload` time and `pm2 save` stores the result.
 */
const ROOT = process.env.DIVVY_ROOT || "/srv/divvy/current";
const ENV_FILE = process.env.DIVVY_ENV_FILE || "/etc/divvy/divvy.env";
const LOG_DIR = process.env.DIVVY_LOG_DIR || "/var/log/divvy";

const logs = (name) => ({
  out_file: `${LOG_DIR}/${name}.out.log`,
  error_file: `${LOG_DIR}/${name}.err.log`,
  // One file per app even with several cluster instances (no -0/-1 suffixes).
  merge_logs: true,
});

const SHELL_ENV_BLOCKLIST = [
  "DATABASE_URL", "REDIS_URL", "API_", "WEB_ORIGIN", "NEXT_PUBLIC_", "SOLANA_", "HELIUS_",
  "JITO_", "JUP_", "KEYPAIR", "PAYOUT", "TELEGRAM_", "LOG_LEVEL", "NODE_OPTIONS",
  "DIVVY_", "LAUNCH", "STORAGE_", "S3_", "PUBLIC_MEDIA", "X_CLIENT", "X_REDIRECT", "X_AUTHORIZE", "X_API",
  "GEO_HEADER", "FEE_", "MIN_", "AUTO_PUSH", "LATE_AFTER", "SWAP_", "BLOCKED_COUNTRIES", "ADMIN_WALLETS",
  "WORKER_", "HOT_WALLET", "HOLDERS_", "INDEXER_", "PUSH_", "CPMM_", "CU_PRICE", "RCLONE_",
];

// Cluster mode only: PM2's cluster container catches unhandled rejections and keeps the process alive.
// A failed boot in an entry with top-level await (bad env, port taken, missing build) would then sit
// "online" without listening. strict turns the rejection back into a crash (Node's own behaviour outside
// PM2), so the failure shows up as restarts with backoff. Either way `pm2 reload` retires the old instance
// once listen_timeout passes, so smoke-test a release before reloading (RUNBOOK "Deploy", step 2).
const CLUSTER_NODE_ARGS = ["--unhandled-rejections=strict"];

const common = {
  filter_env: SHELL_ENV_BLOCKLIST,
  autorestart: true,
  watch: false,
  // Crash loops back off exponentially (200 ms doubling to PM2's 15 s cap) instead of hammering
  // Postgres/Redis. After 30 restarts that each die within min_uptime, PM2 marks the app errored.
  exp_backoff_restart_delay: 200,
  min_uptime: "10s",
  max_restarts: 30,
};

module.exports = {
  apps: [
    {
      ...common,
      name: "divvy-web",
      cwd: `${ROOT}/apps/web`,
      // Same binary as `pnpm --filter @divvy/web start`, but bound to loopback: only Nginx reaches it.
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      // Cluster mode is what makes `pm2 reload` zero-downtime: PM2 starts a new instance, waits for it
      // to listen, then stops an old one. Instances share port 3000 through the cluster primary.
      exec_mode: "cluster",
      instances: 2,
      node_args: [`--env-file=${ENV_FILE}`, "--max-old-space-size=512", ...CLUSTER_NODE_ARGS],
      max_memory_restart: "700M",
      listen_timeout: 15000,
      kill_timeout: 10000,
      env: { NODE_ENV: "production" },
      log_date_format: "YYYY-MM-DDTHH:mm:ss.SSSZ",
      ...logs("web"),
    },
    {
      ...common,
      name: "divvy-api",
      cwd: `${ROOT}/apps/api`,
      script: "dist/server.js",
      // One instance in cluster mode: reloads are still zero-downtime (the replacement listens before the
      // old process is stopped). Live events for WS /api/live are fanned out in-process today, so add
      // instances only once they go through Redis pub/sub. SIWS nonces already need REDIS_URL set.
      exec_mode: "cluster",
      instances: 1,
      node_args: [`--env-file=${ENV_FILE}`, "--max-old-space-size=384", ...CLUSTER_NODE_ARGS],
      max_memory_restart: "512M",
      listen_timeout: 15000,
      // SIGINT runs app.close(), which closes WebSocket clients and drains requests.
      kill_timeout: 10000,
      env: { NODE_ENV: "production" },
      // Fastify logs JSON lines with their own timestamps, so PM2 adds none.
      ...logs("api"),
    },
    {
      ...common,
      name: "divvy-worker",
      cwd: `${ROOT}/apps/worker`,
      script: "dist/index.js",
      // Exactly one worker. Cron jobs (hourly payouts, reserved tickers, indexer) must not double-run.
      // The Redis lock (apps/worker/src/lock.ts) and the unique coin+hour round are backstops, not a
      // licence to scale: never `pm2 scale divvy-worker`, and never start a second copy by hand.
      exec_mode: "fork",
      instances: 1,
      node_args: [`--env-file=${ENV_FILE}`, "--max-old-space-size=384"],
      max_memory_restart: "512M",
      // Room for a graceful drain once the payout engine handles SIGINT mid-round (Phase 4).
      kill_timeout: 130000,
      env: { NODE_ENV: "production" },
      // The worker logs JSON lines with their own timestamps.
      ...logs("worker"),
    },
  ],
};
