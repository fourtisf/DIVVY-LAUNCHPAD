/**
 * Owner alerts (HANDOFF §8): late or failed rounds, low hot-wallet balances, Jito failures, indexer lag,
 * fee attribution gaps. Telegram Bot API sendMessage; the same alert key is sent at most once per window.
 */
import type { Redis } from "ioredis";

export type Severity = "info" | "warn" | "critical";

export interface Alerts {
  send(key: string, severity: Severity, text: string, windowSec?: number): Promise<void>;
}

export function createAlerts(opts: {
  redis: Redis;
  botToken?: string;
  chatId?: string;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}): Alerts {
  const f = opts.fetchImpl ?? fetch;
  return {
    async send(key, severity, text, windowSec = 1800) {
      opts.log(`alert: ${text}`, { key, severity });
      const fresh = await opts.redis.set(`divvy:alert:${key}`, "1", "EX", windowSec, "NX").catch(() => "OK");
      if (fresh !== "OK" || !opts.botToken || !opts.chatId) return;
      const icon = severity === "critical" ? "🔴" : severity === "warn" ? "🟠" : "🔵";
      try {
        const res = await f(`https://api.telegram.org/bot${opts.botToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: opts.chatId, text: `${icon} uspad: ${text}`, disable_web_page_preview: true }),
        });
        if (!res.ok) opts.log("alert: telegram refused", { status: res.status });
      } catch (e) {
        opts.log("alert: telegram unreachable", { error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
