/**
 * Mock versions of the signed-in extras (my payouts, creator fees, reports, admin) so demo mode
 * exercises the same pages as live mode. Nothing here touches a chain.
 */
import type { FastifyInstance } from "fastify";
import { ReportRequestSchema, AdminSettingsRequestSchema, type AdminOverview, type CreatorInfo, type MyPayouts } from "@divvy/shared";
import { sendError } from "../errors";
import { amount, imageUrl, type MockStore } from "../mock/store";
import type { SessionLookup } from "./auth";

export async function extrasRoutes(app: FastifyInstance, { store, session, adminWallets }: { store: MockStore; session: SessionLookup; adminWallets: Set<string> }) {
  const settings = { launchesOpen: true, reason: null as string | null };
  const reports: { mint: string; reason: string; details: string; at: number }[] = [];

  app.get("/api/me/payouts", async (req, reply): Promise<MyPayouts | void> => {
    if (!session(req)) return sendError(reply, 401, "SIGN_IN", "Sign in with your wallet first");
    return { items: [], nextCursor: null };
  });

  app.get("/api/me/creator", async (req, reply): Promise<CreatorInfo | void> => {
    const s = session(req);
    if (!s) return sendError(reply, 401, "SIGN_IN", "Sign in with your wallet first");
    const mine = store.coins.filter((c) => c.creatorWallet === s.wallet);
    return {
      wallet: s.wallet,
      claimable: amount(0, 9),
      coins: mine.map((c) => ({ mint: c.mint, ticker: c.ticker, imageUrl: imageUrl(c), name: c.name, status: c.graduated ? ("graduated" as const) : ("live" as const), creatorFees: amount(c.vol * 0.0015 / 100.7, 9) })),
    };
  });

  app.post("/api/me/creator/claim/build", async (req, reply) => {
    if (!session(req)) return sendError(reply, 401, "SIGN_IN", "Sign in with your wallet first");
    return sendError(reply, 409, "NOTHING_TO_CLAIM", "There's nothing to claim yet");
  });

  app.post<{ Params: { mint: string } }>("/api/coins/:mint/report", async (req, reply) => {
    const body = ReportRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Pick a reason");
    if (!store.coinByMint(req.params.mint)) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    reports.push({ mint: req.params.mint, ...body.data, at: Date.now() });
    return reply.code(201).send({ ok: true });
  });

  const admin = (req: Parameters<SessionLookup>[0]) => {
    const s = session(req);
    return s && adminWallets.has(s.wallet) ? s : null;
  };

  app.get("/api/admin/overview", async (req, reply): Promise<AdminOverview | void> => {
    if (!admin(req)) return sendError(reply, 403, "FORBIDDEN", "Admins only");
    return {
      launchesOpen: settings.launchesOpen,
      launchesPausedReason: settings.reason,
      wallets: [],
      pendingLaunches: [...store.launches.values()].filter((l) => !l.indexed).length,
      openReports: reports.length,
      lateRounds: 0,
      indexerLagSec: null,
      mainnetEnabled: false,
      dryRun: true,
    };
  });

  app.post("/api/admin/settings", async (req, reply) => {
    if (!admin(req)) return sendError(reply, 403, "FORBIDDEN", "Admins only");
    const body = AdminSettingsRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Invalid settings");
    settings.launchesOpen = body.data.launchesOpen;
    settings.reason = body.data.reason;
    return { ok: true };
  });

  app.get("/api/admin/reports", async (req, reply) => {
    if (!admin(req)) return sendError(reply, 403, "FORBIDDEN", "Admins only");
    return {
      items: reports.map((r, i) => {
        const c = store.coinByMint(r.mint)!;
        return { id: String(i), coin: { mint: c.mint, ticker: c.ticker, imageUrl: imageUrl(c), name: c.name, hidden: false }, reason: r.reason, details: r.details, status: "open" as const, createdAt: new Date(r.at).toISOString() };
      }),
    };
  });
}
