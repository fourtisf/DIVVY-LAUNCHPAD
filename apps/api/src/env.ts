import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_MODE: z.enum(["mock", "live"]).default("mock"),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32).optional(),
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(src);
  if (env.API_MODE === "mock" && env.NODE_ENV === "production") {
    throw new Error("API_MODE=mock serves demo data and unauthenticated launches; refusing to start with NODE_ENV=production");
  }
  if (env.API_MODE === "live") {
    throw new Error("API_MODE=live is built in Phase 2 (Prisma-backed routes); use API_MODE=mock for now");
  }
  return env;
}
