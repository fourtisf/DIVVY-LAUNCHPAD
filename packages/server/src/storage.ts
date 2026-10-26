/**
 * Public object storage for coin pictures and token metadata JSON.
 * - local: files under STORAGE_DIR, served by the API at /api/media/files/* (or by Nginx).
 * - s3: any S3-compatible bucket (AWS, Cloudflare R2, Filebase/IPFS, ...). Token metadata URIs are
 *   permanent once a coin is created, so production should use durable storage (decision: owner).
 */
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

export interface Storage {
  readonly driver: "local" | "s3";
  /** Stores the object and returns its public URL. Keys are content-addressed by the callers. */
  put(key: string, body: Buffer, contentType: string): Promise<string>;
  /** Local driver only: read back for serving. */
  read?(key: string): Promise<{ body: Buffer; contentType: string } | null>;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;
export function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("invalid storage key");
}

const TYPES: Record<string, string> = { webp: "image/webp", json: "application/json", png: "image/png" };

export function localStorage(dir: string, publicBase: string): Storage {
  const root = normalize(dir);
  const path = (key: string) => {
    assertKey(key);
    const p = normalize(join(root, key));
    if (!p.startsWith(root + sep)) throw new Error("invalid storage key");
    return p;
  };
  return {
    driver: "local",
    async put(key, body) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body, { mode: 0o644 });
      return publicBase.replace(/\/$/, "") + "/" + key;
    },
    async read(key) {
      try {
        const body = await readFile(path(key));
        return { body, contentType: TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
  };
}

export function s3Storage(cfg: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicBase: string }): Storage {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: !!cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    driver: "s3",
    async put(key, body, contentType) {
      assertKey(key);
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
      return cfg.publicBase.replace(/\/$/, "") + "/" + key;
    },
  };
}

const StorageEnv = z.discriminatedUnion("STORAGE_DRIVER", [
  z.object({ STORAGE_DRIVER: z.literal("local"), STORAGE_DIR: z.string().default("./data/media"), PUBLIC_MEDIA_BASE: z.string().url() }),
  z.object({
    STORAGE_DRIVER: z.literal("s3"),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    PUBLIC_MEDIA_BASE: z.string().url(),
  }),
]);

/**
 * Token metadata URIs are written on chain at create time, so in production a picture must never
 * live inside the release folder (lost on redeploy) or behind a URL only this machine can open (audit).
 */
export function assertProductionStorage(e: z.infer<typeof StorageEnv>, cwd = process.cwd()): void {
  const base = new URL(e.PUBLIC_MEDIA_BASE);
  if (base.protocol !== "https:") throw new Error("PUBLIC_MEDIA_BASE must be https in production");
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.)/.test(base.hostname)) throw new Error("PUBLIC_MEDIA_BASE must be a public host in production");
  if (e.STORAGE_DRIVER !== "local") return;
  if (!isAbsolute(e.STORAGE_DIR)) throw new Error("STORAGE_DIR must be an absolute path in production (e.g. /var/lib/divvy/media)");
  // The release is the workspace root above the app folder, under the path it was started by
  // (/srv/divvy/current/...) and the folder that link points to (/srv/divvy/releases/<id>/...).
  const inside = (root: string) => {
    const rel = relative(root, resolve(e.STORAGE_DIR));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  const roots = [workspaceRoot(resolve(cwd)), workspaceRoot(realpathOr(resolve(cwd)))];
  if (roots.some(inside)) throw new Error("STORAGE_DIR must be outside the release folder in production");
}

function realpathOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** The nearest folder at or above `from` holding pnpm-workspace.yaml (the release), else `from`. */
function workspaceRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) return from;
  }
}

export function loadStorage(src: Record<string, string | undefined> = process.env): Storage {
  const e = StorageEnv.parse({ STORAGE_DRIVER: "local", ...Object.fromEntries(Object.entries(src).filter(([, v]) => v !== undefined && v !== "")) });
  if (src.NODE_ENV === "production") assertProductionStorage(e);
  if (e.STORAGE_DRIVER === "local") return localStorage(e.STORAGE_DIR, e.PUBLIC_MEDIA_BASE);
  return s3Storage({ endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET, accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY, publicBase: e.PUBLIC_MEDIA_BASE });
}
