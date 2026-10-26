import { buildApp } from "./app";
import { loadEnv } from "./env";

const env = loadEnv();
const app = await buildApp({ env });
await app.listen({ port: env.API_PORT, host: env.API_HOST });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0), () => process.exit(1));
  });
}
