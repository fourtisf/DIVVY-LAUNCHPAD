/** Admin: launch switch, moderation and an operational overview. Every action is written to AdminAction. */
import type { FastifyInstance } from "fastify";
import { AdminHideRequestSchema, AdminReportUpdateSchema, AdminSettingsRequestSchema, type AdminOverview, type AdminReportList } from "@divvy/shared";
import { getLaunchSettings, readStatus, setLaunchSettings } from "@divvy/server";
import { sendError } from "../../errors";
import type { LiveDeps } from "../deps";
import { HOUR, invalidateBoard, topOfHour } from "../data";
import { requireAdmin } from "../viewer";

export async function liveAdminRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  const audit = (admin: string, action: string, target: string | null, payload: object) =>
    d.prisma.adminAction.create({ data: { adminWallet: admin, action, target, payload: payload as object } });

  app.get("/api/admin/overview", async (req, reply): Promise<AdminOverview | void> => {
    if (!(await requireAdmin(d, req, reply))) return;
    const [settings, status, pendingLaunches, openReports, lateRounds] = await Promise.all([
      getLaunchSettings(d.prisma),
      readStatus(d.redis),
      d.prisma.launch.count({ where: { step: { in: ["checking", "bundling", "landed"] } } }),
      d.prisma.report.count({ where: { status: "open" } }),
      d.prisma.payoutRound.count({ where: { dryRun: d.params.dryRun, status: { in: ["late", "failed"] }, hour: { gte: new Date(topOfHour(Date.now()) - 24 * HOUR) } } }),
    ]);
    return {
      launchesOpen: settings.launchesOpen,
      launchesPausedReason: settings.reason,
      wallets: status?.wallets ?? [],
      pendingLaunches,
      openReports,
      lateRounds,
      indexerLagSec: status?.indexerLagSec ?? null,
      mainnetEnabled: d.sol.mainnetEnabled,
      dryRun: d.params.dryRun,
    };
  });

  app.post("/api/admin/settings", async (req, reply) => {
    const a = await requireAdmin(d, req, reply);
    if (!a) return;
    const body = AdminSettingsRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Invalid settings");
    await setLaunchSettings(d.prisma, { launchesOpen: body.data.launchesOpen, reason: body.data.reason });
    await audit(a.wallet, "settings.launches", null, body.data);
    return { ok: true };
  });

  app.post<{ Params: { mint: string } }>("/api/admin/coins/:mint/hide", async (req, reply) => {
    const a = await requireAdmin(d, req, reply);
    if (!a) return;
    const body = AdminHideRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Invalid request");
    const r = await d.prisma.coin.updateMany({ where: { mint: req.params.mint }, data: { hidden: body.data.hidden, hiddenReason: body.data.reason } });
    if (!r.count) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    await audit(a.wallet, body.data.hidden ? "coin.hide" : "coin.unhide", req.params.mint, body.data);
    invalidateBoard();
    return { ok: true };
  });

  app.get("/api/admin/reports", async (req, reply): Promise<AdminReportList | void> => {
    if (!(await requireAdmin(d, req, reply))) return;
    const rows = await d.prisma.report.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" }, take: 200, include: { coin: true } });
    return {
      items: rows
        .filter((r) => r.coin.mint)
        .map((r) => ({
          id: r.id,
          coin: { mint: r.coin.mint!, ticker: r.coin.ticker, imageUrl: r.coin.imageUrl, name: r.coin.name, hidden: r.coin.hidden },
          reason: r.reason,
          details: r.details,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/admin/reports/:id", async (req, reply) => {
    const a = await requireAdmin(d, req, reply);
    if (!a) return;
    const body = AdminReportUpdateSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Invalid status");
    const r = await d.prisma.report.updateMany({ where: { id: req.params.id }, data: { status: body.data.status, resolvedBy: a.wallet, resolvedAt: body.data.status === "open" ? null : new Date() } });
    if (!r.count) return sendError(reply, 404, "NOT_FOUND", "No such report");
    await audit(a.wallet, "report.update", req.params.id, body.data);
    return { ok: true };
  });
}
