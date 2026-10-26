/**
 * Cluster configuration and the mainnet gate.
 *
 * Program IDs come from the Raydium SDK's own tables (ALL_PROGRAM_ID / DEVNET_PROGRAM_ID in
 * raydium-sdk-V2 src/common/programId.ts), never typed by hand.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { ALL_PROGRAM_ID, DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import { z } from "zod";

export type Cluster = "mainnet-beta" | "devnet";

const Env = z.object({
  SOLANA_CLUSTER: z.enum(["mainnet-beta", "devnet"]).default("devnet"),
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_WS_URL: z.string().url().optional(),
  /** Divvy's PlatformConfig (created once, with the owner's approval). */
  DIVVY_PLATFORM_CONFIG: z.string().min(32),
  /** LaunchLab GlobalConfig for SOL / constant product. Defaults to the SDK's LAUNCHPAD_CONFIG. */
  LAUNCHLAB_GLOBAL_CONFIG: z.string().min(32).optional(),
  JITO_BLOCK_ENGINE_URL: z.string().url().default("https://mainnet.block-engine.jito.wtf"),
  JITO_UUID: z.string().optional(),
  JITO_TIP_LAMPORTS: z.coerce.number().int().min(1000).default(100_000),
  JUP_BASE_URL: z.string().url().default("https://api.jup.ag"),
  JUP_API_KEY: z.string().optional(),
  /** Set to "true" only after the audit sign-off (docs/MAINNET_CHECKLIST.md). */
  DIVVY_MAINNET_ENABLED: z.enum(["true", "false"]).default("false"),
});

export interface SolanaEnv {
  cluster: Cluster;
  rpcUrl: string;
  wsUrl?: string;
  platformConfig: PublicKey;
  globalConfig: PublicKey;
  jitoUrl: string;
  jitoUuid?: string;
  jitoTipLamports: number;
  jupBaseUrl: string;
  jupApiKey?: string;
  mainnetEnabled: boolean;
}

export function programs(cluster: Cluster) {
  const p = cluster === "devnet" ? DEVNET_PROGRAM_ID : ALL_PROGRAM_ID;
  return {
    launchLab: p.LAUNCHPAD_PROGRAM,
    launchLabAuth: p.LAUNCHPAD_AUTH,
    defaultGlobalConfig: p.LAUNCHPAD_CONFIG,
    cpmm: p.CREATE_CPMM_POOL_PROGRAM,
    lpLock: p.LOCK_CPMM_PROGRAM,
  };
}

export function loadSolanaEnv(src: NodeJS.ProcessEnv = process.env): SolanaEnv {
  const e = Env.parse(Object.fromEntries(Object.entries(src).filter(([, v]) => v !== undefined && v !== "")));
  return {
    cluster: e.SOLANA_CLUSTER,
    rpcUrl: e.SOLANA_RPC_URL,
    wsUrl: e.SOLANA_WS_URL,
    platformConfig: new PublicKey(e.DIVVY_PLATFORM_CONFIG),
    globalConfig: new PublicKey(e.LAUNCHLAB_GLOBAL_CONFIG ?? programs(e.SOLANA_CLUSTER).defaultGlobalConfig.toBase58()),
    jitoUrl: e.JITO_BLOCK_ENGINE_URL,
    jitoUuid: e.JITO_UUID,
    jitoTipLamports: e.JITO_TIP_LAMPORTS,
    jupBaseUrl: e.JUP_BASE_URL,
    jupApiKey: e.JUP_API_KEY,
    mainnetEnabled: e.DIVVY_MAINNET_ENABLED === "true",
  };
}

export const connection = (env: Pick<SolanaEnv, "rpcUrl" | "wsUrl">): Connection =>
  new Connection(env.rpcUrl, { commitment: "confirmed", wsEndpoint: env.wsUrl });

export class MainnetDisabledError extends Error {
  constructor(purpose: string) {
    super(`Refusing to send "${purpose}" on mainnet: DIVVY_MAINNET_ENABLED is not "true" (set it only after the audit sign-off)`);
  }
}

/** Every code path that signs and sends calls this first. Devnet is always allowed. */
export function assertCanSend(env: Pick<SolanaEnv, "cluster" | "mainnetEnabled">, purpose: string): void {
  if (env.cluster === "mainnet-beta" && !env.mainnetEnabled) throw new MainnetDisabledError(purpose);
}
