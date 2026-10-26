/** Display formatters, ported 1:1 from the prototype so numbers read the same everywhere. */

export function usd(v: number | null | undefined, dp?: number): string {
  if (v == null || Number.isNaN(v)) return "n/a";
  if (v === 0) return "$0";
  const a = Math.abs(v);
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "$" + (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k";
  if (a >= 1) return "$" + v.toFixed(dp ?? (a >= 100 ? 0 : 2));
  return "$" + v.toFixed(dp ?? 2);
}

export const usdFull = (v: number): string => "$" + Math.round(v).toLocaleString("en-US");

export function num(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

export const sol = (v: number): string => (v >= 10 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toFixed(4)) + " SOL";

/** "just now", "12m ago", "3h ago", "2d ago" from a number of minutes. */
export function agoMin(min: number): string {
  if (min < 1) return "just now";
  if (min < 60) return Math.round(min) + "m ago";
  if (min < 1440) return Math.floor(min / 60) + "h ago";
  return Math.floor(min / 1440) + "d ago";
}

export const minutesSince = (iso: string | number | Date, now: number = Date.now()): number =>
  Math.max(0, (now - new Date(iso).getTime()) / 60_000);

export const ago = (iso: string | number | Date, now: number = Date.now()): string => agoMin(minutesSince(iso, now));

export const short = (a: string): string => a.slice(0, 4) + "…" + a.slice(-4);

export const pct = (v: number): string => (v > 0 ? "+" : "") + v.toFixed(1) + "%";

/** Seconds until `nextAt` as "MM:SS" (clamped at 00:00). */
export function countdown(nextAt: string | number | Date, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((new Date(nextAt).getTime() - now) / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/** Fraction (0..1) of the current payout interval that has elapsed. */
export function intervalFrac(nextAt: string | number | Date, intervalSec: number, now: number = Date.now()): number {
  const left = (new Date(nextAt).getTime() - now) / 1000;
  return Math.min(1, Math.max(0, 1 - left / intervalSec));
}

/** Converts a base-unit string to a display number. Precision loss above 2^53 is fine for display only. */
export function uiAmount(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}
