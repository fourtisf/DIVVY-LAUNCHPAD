import { assertClusterMatchesRpc, connection, loadSolanaEnv } from "@divvy/solana/live";
import { buildApp } from "./app";
import { loadEnv } from "./env";

const env = loadEnv();
if (env.API_MODE === "live") {
  // Quotes, fee figures and the transactions the API builds assume SOLANA_CLUSTER: refuse to start if
  // the RPC is another cluster (the worker checks the same at its start).
  const sol = loadSolanaEnv();
  await assertClusterMatchesRpc(connection(sol), sol.cluster);
}
const app = await buildApp({ env });
await app.listen({ port: env.API_PORT, host: env.API_HOST });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0), () => process.exit(1));
  });
}
