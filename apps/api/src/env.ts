import { z } from "zod";
import { definedEnv } from "@divvy/shared";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_MODE: z.enum(["mock", "live"]).default("mock"),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  REDIS_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Header carrying the visitor's ISO country code, set by Nginx GeoIP2 or Cloudflare. */
  GEO_HEADER: z.string().default("x-geo-country"),
  /** X OAuth 2.0 (confidential client). Endpoints from X's official SDK; see docs/VERIFIED.md. */
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_REDIRECT_URI: z.string().url().optional(),
  X_AUTHORIZE_URL: z.string().url().default("https://x.com/i/oauth2/authorize"),
  X_API_BASE: z.string().url().default("https://api.x.com"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(definedEnv(src));
  if (env.API_MODE === "mock" && env.NODE_ENV === "production") {
    throw new Error("API_MODE=mock serves demo data and unauthenticated launches; refusing to start with NODE_ENV=production");
  }
  if (env.API_MODE === "live") {
    if (!env.REDIS_URL) throw new Error("API_MODE=live needs REDIS_URL");
    if (!env.DATABASE_URL) throw new Error("API_MODE=live needs DATABASE_URL");
  }
  return env;
}
