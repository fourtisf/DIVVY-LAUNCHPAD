import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import bs58 from "bs58";
import { KEYS, VerifyRequestSchema, type Me } from "@divvy/shared";
import { sendError } from "../../errors";
import type { Kv } from "../../kv";
import { signedMessageMatches, siwsInput, siwsText, verifyEd25519 } from "../../routes/auth";
import type { LiveDeps } from "../deps";
import { amount } from "../data";
import { endSession, getViewer, isBlockedCountry, requireViewer, startSession } from "../viewer";

const NONCE_TTL_SEC = 300;
const b64url = (b: Buffer) => b.toString("base64url");

function decodeB58(s: string): Uint8Array | null {
  try {
    return bs58.decode(s);
  } catch {
    return null;
  }
}

export async function liveAuthRoutes(app: FastifyInstance, { d, kv }: { d: LiveDeps; kv: Kv }) {
  const origin = new URL(d.env.WEB_ORIGIN);

  app.get<{ Querystring: { address?: string } }>("/api/auth/nonce", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const address = req.query.address ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return sendError(reply, 400, "BAD_ADDRESS", "That isn't a Solana address");
    const pk = decodeB58(address);
    if (!pk || pk.length !== 32) return sendError(reply, 400, "BAD_ADDRESS", "That isn't a Solana address");
    const nonce = randomBytes(16).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NONCE_TTL_SEC * 1000);
    const input = siwsInput(origin.host, origin.origin, address, nonce, now, expiresAt, d.sol.cluster === "mainnet-beta" ? "mainnet" : d.sol.cluster);
    const message = siwsText(input);
    await kv.setNonce(nonce, JSON.stringify({ address, message }), NONCE_TTL_SEC);
    return { nonce, message, input, expiresAt: expiresAt.toISOString() };
  });

  app.post("/api/auth/verify", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = VerifyRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Missing address, signature or nonce");
    const raw = await kv.takeNonce(body.data.nonce);
    if (!raw) return sendError(reply, 401, "NONCE_EXPIRED", "That sign-in request expired. Try again.");
    const { address, message } = JSON.parse(raw) as { address: string; message: string };
    const pk = decodeB58(address);
    const sig = decodeB58(body.data.signature);
    if (address === body.data.address && !signedMessageMatches(body.data.signedMessage, message)) return sendError(reply, 401, "SIGN_IN_MISMATCH", "Your wallet signed a different message. Try again.");
    if (address !== body.data.address || !pk || !sig || !verifyEd25519(message, sig, pk)) return sendError(reply, 401, "BAD_SIGNATURE", "The signature doesn't match this wallet");
    await startSession(d, reply, address);
    return { ok: true, wallet: address };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    await endSession(d, req, reply);
    return { ok: true };
  });

  app.get("/api/me", async (req): Promise<Me> => {
    const v = await getViewer(d, req);
    const blocked = isBlockedCountry(d, req);
    if (!v) return { wallet: null, isAdmin: false, blocked, x: null, launchesToday: 0, launchesLeftToday: d.params.launchesPerWalletPerDay, claimable: [] };
    const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const [launchesToday, credits, prices] = await Promise.all([
      d.prisma.launch.count({ where: { userId: v.userId, createdAt: { gte: dayStart }, step: { not: "failed" } } }),
      d.prisma.credit.findMany({ where: { wallet: v.wallet, amount: { gt: 0n } }, include: { asset: true } }),
      d.prices(),
    ]);
    return {
      wallet: v.wallet,
      isAdmin: v.isAdmin,
      blocked,
      x: v.xUserId && v.xHandle ? { userId: v.xUserId, handle: v.xHandle } : null,
      launchesToday,
      launchesLeftToday: Math.max(0, d.params.launchesPerWalletPerDay - launchesToday),
      claimable: credits.map((c) => {
        const a = amount(c.amount, c.asset.decimals);
        return { assetSymbol: c.asset.symbol, amount: a, usd: a.ui * (prices.byMint[c.asset.mint] ?? 0) };
      }),
    };
  });

  /* ---------- X OAuth 2.0, authorization code + PKCE (S256) ---------- */

  const xReady = () => d.env.X_CLIENT_ID && d.env.X_CLIENT_SECRET && d.env.X_REDIRECT_URI;
  const back = (q: string) => `${d.env.WEB_ORIGIN.replace(/\/$/, "")}/create?${q}`;

  app.get("/api/auth/x/start", async (req, reply) => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    if (!xReady()) return sendError(reply, 501, "NOT_AVAILABLE", "Linking an X account isn't available yet");
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    await d.redis.set(KEYS.xOAuthState(state), JSON.stringify({ userId: v.userId, verifier }), "EX", 600);
    const url = new URL(d.env.X_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: d.env.X_CLIENT_ID!,
      redirect_uri: d.env.X_REDIRECT_URI!,
      scope: "users.read tweet.read",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/auth/x/callback", async (req, reply) => {
    if (!xReady()) return sendError(reply, 501, "NOT_AVAILABLE", "Linking an X account isn't available yet");
    const { code, state, error } = req.query;
    if (error || !code || !state || state.length > 64) return reply.redirect(back("x=cancelled"));
    const raw = await d.redis.getdel(KEYS.xOAuthState(state));
    if (!raw) return reply.redirect(back("x=expired"));
    const { userId, verifier } = JSON.parse(raw) as { userId: string; verifier: string };
    const v = await getViewer(d, req);
    if (!v || v.userId !== userId) return reply.redirect(back("x=expired"));

    const api = d.env.X_API_BASE.replace(/\/$/, "");
    const basic = Buffer.from(`${d.env.X_CLIENT_ID}:${d.env.X_CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch(`${api}/2/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
      body: new URLSearchParams({ code, grant_type: "authorization_code", code_verifier: verifier, client_id: d.env.X_CLIENT_ID!, redirect_uri: d.env.X_REDIRECT_URI! }),
    });
    if (!tokenRes.ok) return reply.redirect(back("x=failed"));
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return reply.redirect(back("x=failed"));
    const meRes = await fetch(`${api}/2/users/me`, { headers: { authorization: `Bearer ${token.access_token}` } });
    if (!meRes.ok) return reply.redirect(back("x=failed"));
    const me = (await meRes.json()) as { data?: { id?: string; username?: string } };
    const xId = me.data?.id;
    const handle = me.data?.username;
    if (!xId || !handle || !/^\d{1,25}$/.test(xId) || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return reply.redirect(back("x=failed"));
    // The access token isn't kept: we only need the verified user id (HANDOFF §5).
    const taken = await d.prisma.user.findUnique({ where: { xUserId: xId } });
    if (taken && taken.id !== userId) return reply.redirect(back("x=taken"));
    await d.prisma.user.update({ where: { id: userId }, data: { xUserId: xId, xHandle: handle } });
    return reply.redirect(back("x=linked"));
  });
}
