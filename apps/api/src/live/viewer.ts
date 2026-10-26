/** Sessions (DB-backed), the current viewer, and request guards. */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../errors";
import type { LiveDeps } from "./deps";

export const SESSION_COOKIE = "divvy_session";
export const SESSION_TTL_MS = 7 * 24 * 3600_000;
/** Admin powers last 12 hours from sign-in; after that the admin signs in again (audit: a stolen week-long cookie). */
export const ADMIN_SESSION_MS = 12 * 3600_000;

export interface Viewer {
  userId: string;
  wallet: string;
  xUserId: string | null;
  xHandle: string | null;
  isAdmin: boolean;
}

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

declare module "fastify" {
  interface FastifyRequest {
    viewerCache?: Viewer | null;
  }
}

export async function getViewer(d: LiveDeps, req: FastifyRequest): Promise<Viewer | null> {
  if (req.viewerCache !== undefined) return req.viewerCache;
  const token = req.cookies["divvy_session"];
  let v: Viewer | null = null;
  if (token && token.length <= 128) {
    const s = await d.prisma.session.findUnique({ where: { id: tokenHash(token) }, include: { user: true } });
    if (s && s.expiresAt > new Date())
      v = { userId: s.userId, wallet: s.user.wallet, xUserId: s.user.xUserId, xHandle: s.user.xHandle, isAdmin: d.params.adminWallets.has(s.user.wallet) && Date.now() - s.createdAt.getTime() < ADMIN_SESSION_MS };
  }
  req.viewerCache = v;
  return v;
}

export async function startSession(d: LiveDeps, reply: FastifyReply, wallet: string): Promise<void> {
  const user = await d.prisma.user.upsert({ where: { wallet }, create: { wallet }, update: {} });
  const token = randomBytes(32).toString("base64url");
  await d.prisma.session.create({ data: { id: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: d.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_MS / 1000 });
}

export async function endSession(d: LiveDeps, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await d.prisma.session.deleteMany({ where: { id: tokenHash(token) } });
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function requireViewer(d: LiveDeps, req: FastifyRequest, reply: FastifyReply): Promise<Viewer | null> {
  const v = await getViewer(d, req);
  if (!v) {
    await sendError(reply, 401, "SIGN_IN", "Sign in with your wallet first");
    return null;
  }
  return v;
}

export async function requireAdmin(d: LiveDeps, req: FastifyRequest, reply: FastifyReply): Promise<Viewer | null> {
  const v = await getViewer(d, req);
  if (!v || !v.isAdmin) {
    await sendError(reply, 403, "FORBIDDEN", "Admins only");
    return null;
  }
  return v;
}

export const country = (d: LiveDeps, req: FastifyRequest): string | null => {
  const raw = req.headers[d.env.GEO_HEADER.toLowerCase()];
  const c = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : null;
};

/** Country codes GeoIP/Cloudflare use for "unknown" and Tor; never allowed to launch or claim. */
const UNKNOWN_COUNTRIES = new Set(["XX", "T1"]);

/**
 * Whether this visitor may not launch or claim (HANDOFF §10). In production an unknown country is
 * refused too: the GeoIP header is set by Nginx on every request, so a missing value means we can't
 * tell where the visitor is (audit).
 */
export function isBlockedCountry(d: LiveDeps, req: FastifyRequest): boolean {
  const c = country(d, req);
  if (!c) return d.env.NODE_ENV === "production";
  return UNKNOWN_COUNTRIES.has(c) || d.params.blockedCountries.has(c);
}

/** Launching and claiming stock tokens are refused from blocked countries (HANDOFF §10). */
export async function refuseBlockedCountry(d: LiveDeps, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (isBlockedCountry(d, req)) {
    await sendError(reply, 451, "REGION_BLOCKED", "Divvy isn't available in your country");
    return true;
  }
  return false;
}
