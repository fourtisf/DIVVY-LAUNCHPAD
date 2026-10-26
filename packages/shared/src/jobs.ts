/** Queue names and payloads shared by the API (producer) and the worker (consumer). */
export const QUEUES = {
  launch: "divvy-launch",
  claims: "divvy-claims",
} as const;

export interface LaunchJob {
  launchId: string;
}

export interface ClaimJob {
  wallet: string;
  assetId: string;
}

/** Result of building a claim: a transaction partially signed by the payout vault. */
export interface ClaimJobResult {
  tx: string | null;
  amount: string;
  error?: { code: string; message: string };
}

/** Redis keys shared between processes. */
export const KEYS = {
  liveChannel: "divvy:live",
  prices: "divvy:prices",
  status: "divvy:status",
  launchCooldown: (wallet: string) => `divvy:launch-cooldown:${wallet}`,
  launcherSpend: (hour: string) => `divvy:launcher-spend:${hour}`,
  xOAuthState: (state: string) => `divvy:x-oauth:${state}`,
} as const;
