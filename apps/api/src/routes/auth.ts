/**
 * Sign-In With Solana (HANDOFF §3.1, §9). The nonce is single-use with a 5-minute TTL, the message is
 * built and remembered by the server (the client can't change what it signs), the ed25519 signature
 * is verified with node:crypto, and the session is an httpOnly SameSite=Lax cookie.
 *
 * Sessions live in memory in mock mode; Phase 2 moves them to the Session table and nonces to Redis.
 */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import bs58 from "bs58";
import { VerifyRequestSchema, type Me } from "@divvy/shared";
import type { Env } from "../env";
import { sendError } from "../errors";
import type { Kv } from "../kv";
import type { MockStore } from "../mock/store";

export const SESSION_COOKIE = "divvy_session";
const NONCE_TTL_SEC = 300;
const SESSION_TTL_MS = 7 * 24 * 3600_000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type SessionLookup = (req: FastifyRequest) => { wallet: string } | null;

const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex");

export function verifyEd25519(message: string, signature: Uint8Array, publicKey: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]), format: "der", type: "spki" });
  return verify(null, Buffer.from(message, "utf8"), key, signature);
}

export function siwsMessage(domain: string, uri: string, address: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    address,
    "",
    "Sign in to Divvy.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}

function decodeB58(s: string): Uint8Array | null {
  try {
    return bs58.decode(s);
  } catch {
    return null;
  }
}

export function makeSessionLookup(store: MockStore): SessionLookup {
  return (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return null;
    const s = store.sessions.get(tokenKey(token));
    if (!s || s.expiresAt < Date.now()) return null;
    return { wallet: s.wallet };
  };
}

export async function authRoutes(
  app: FastifyInstance,
  { store, env, kv, session, adminWallets, blockedCountries = new Set<string>() }: { store: MockStore; env: Env; kv: Kv; session: SessionLookup; adminWallets: Set<string>; blockedCountries?: Set<string> },
) {
  const origin = new URL(env.WEB_ORIGIN);

  app.get<{ Querystring: { address?: string } }>("/api/auth/nonce", async (req, reply) => {
    const address = req.query.address ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return sendError(reply, 400, "BAD_ADDRESS", "That isn't a Solana address");
    const pk = decodeB58(address);
    if (!pk || pk.length !== 32) return sendError(reply, 400, "BAD_ADDRESS", "That isn't a Solana address");
    const nonce = randomBytes(16).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NONCE_TTL_SEC * 1000);
    const message = siwsMessage(origin.host, origin.origin, address, nonce, now, expiresAt);
    await kv.setNonce(nonce, JSON.stringify({ address, message }), NONCE_TTL_SEC);
    return { nonce, message, expiresAt: expiresAt.toISOString() };
  });

  app.post("/api/auth/verify", async (req, reply) => {
    const body = VerifyRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Missing address, signature or nonce");
    const raw = await kv.takeNonce(body.data.nonce); // single use, whatever happens next
    if (!raw) return sendError(reply, 401, "NONCE_EXPIRED", "That sign-in request expired. Try again.");
    const { address, message } = JSON.parse(raw) as { address: string; message: string };
    if (address !== body.data.address) return sendError(reply, 401, "BAD_SIGNATURE", "The signature doesn't match this wallet");
    const pk = decodeB58(address);
    const sig = decodeB58(body.data.signature);
    if (!pk || !sig || !verifyEd25519(message, sig, pk)) return sendError(reply, 401, "BAD_SIGNATURE", "The signature doesn't match this wallet");
    const token = randomBytes(32).toString("base64url");
    store.sessions.set(tokenKey(token), { wallet: address, expiresAt: Date.now() + SESSION_TTL_MS });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return { ok: true, wallet: address };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) store.sessions.delete(tokenKey(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req): Promise<Me> => {
    const s = session(req);
    const today = new Date().setUTCHours(0, 0, 0, 0);
    const launchesToday = s ? [...store.launches.values()].filter((l) => l.coin.creatorWallet === s.wallet && l.startedAt >= today).length : 0;
    // Demo data: the same header the live API reads (Nginx GeoIP2), checked against BLOCKED_COUNTRIES.
    const geo = String(req.headers["x-geo-country"] ?? "").trim().toUpperCase();
    const blocked = /^[A-Z]{2}$/.test(geo) && blockedCountries.has(geo);
    return { wallet: s?.wallet ?? null, isAdmin: !!s && adminWallets.has(s.wallet), blocked, x: null, launchesToday, launchesLeftToday: Math.max(0, 3 - launchesToday), claimable: [] };
  });

  // X OAuth 2.0 linking is Phase 2. The routes exist so the contract is complete.
  const notYet = async (_req: FastifyRequest, reply: import("fastify").FastifyReply) =>
    sendError(reply, 501, "NOT_AVAILABLE", "Linking an X account isn't available yet");
  app.get("/api/auth/x/start", notYet);
  app.get("/api/auth/x/callback", notYet);
}
