import { z } from "zod";
import { definedEnv } from "@divvy/shared";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  /** Which parts this process runs. Split them across processes with PM2 if needed. */
  WORKER_ROLES: z
    .string()
    .default("launch,claims,indexer,payouts,prices,status,reserved")
    .transform((s) => new Set(s.split(",").map((x) => x.trim()).filter(Boolean))),
  /** Keypair files (solana-keygen JSON, chmod 600) outside the repo. Each role loads only its own. */
  LAUNCHER_KEYPAIR_PATH: z.string().optional(),
  PAYOUT_VAULT_KEYPAIR_PATH: z.string().optional(),
  FEE_CLAIMER_KEYPAIR_PATH: z.string().optional(),
  /** Alert when a hot wallet holds less than this many SOL. */
  HOT_WALLET_MIN_SOL: z.coerce.number().nonnegative().default(0.5),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ALERT_CHAT_ID: z.string().optional(),
  /** Helius DAS getTokenAccounts for holder snapshots; falls back to getProgramAccounts. */
  HOLDERS_VIA_DAS: bool.default(true),
  /** Polling interval for new signatures on the PlatformConfig (the WebSocket wakes it sooner). */
  INDEXER_POLL_MS: z.coerce.number().int().min(500).default(4000),
  /** getTransaction calls the indexer keeps in flight on one stream (applied in order either way). */
  INDEXER_FETCH_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  /** Push delivery: create a holder's xStock ATA only once what we owe them is worth at least this. */
  PUSH_NEW_ATA_MIN_USD: z.coerce.number().positive().default(5),
  /** Transfers per push transaction (each may also create an ATA). */
  // 9 sends that each create a token account still fit in 1,232 bytes; 10 don't (audit; ECONOMICS.md).
  PUSH_BATCH_SIZE: z.coerce.number().int().min(1).max(9).default(6),
  /**
   * Collect the CPMM creator fee of graduated coins whose pool_creator is the fee claimer
   * (PlatformConfig.platform_cp_creator). Off until that update is made with the owner's approval.
   */
  CPMM_CREATOR_FEES: bool.default(false),
  /**
   * Collect graduated coins' locked-LP fees with the Fee Key (PlatformConfig.platform_lock_nft_wallet
   * must be the fee claimer). Off: each run only simulates and logs what it would collect.
   */
  LOCKED_LP_FEES: bool.default(false),
  /** Forward a creator's share of post-graduation fees once it reaches this many lamports (0.01 SOL). */
  CREATOR_FORWARD_MIN_LAMPORTS: z.coerce.number().int().positive().default(10_000_000),
  /** Priority fee for Divvy's own transactions (claims, swaps, pushes), micro-lamports per CU. */
  CU_PRICE_MICRO_LAMPORTS: z.coerce.number().int().nonnegative().default(20_000),
  /** Hourly caps on what the hot wallets may move (HANDOFF §9): fee-claimer swaps, payout-vault sends. */
  SWAP_HOURLY_CAP_LAMPORTS: z.coerce.number().int().positive().default(100_000_000_000),
  /** Largest swap per dividend asset per hour. Halves after a swap is refused for price impact, grows back after good ones. */
  SWAP_BATCH_MAX_LAMPORTS: z.coerce.number().int().positive().default(20_000_000_000),
  PUSH_HOURLY_CAP_USD: z.coerce.number().positive().default(25_000),
  /**
   * uspad's launch fee, paid by the creator inside their coin's create to LAUNCH_FEE_WALLET (owner
   * decision 2026-10-27). The same values as the API's (go-live.sh launch-fee sets both).
   */
  LAUNCH_FEE_LAMPORTS: z.coerce.bigint().nonnegative().default(0n),
  LAUNCH_FEE_WALLET: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .optional(),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

export function loadWorkerEnv(src: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const env = EnvSchema.parse(definedEnv(src));
  if (env.LAUNCH_FEE_LAMPORTS > 0n && !env.LAUNCH_FEE_WALLET) throw new Error("LAUNCH_FEE_LAMPORTS needs LAUNCH_FEE_WALLET, the wallet the fee goes to");
  return env;
}
