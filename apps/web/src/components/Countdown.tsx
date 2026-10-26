"use client";

import { countdown, intervalFrac } from "@divvy/shared";
import { useNow } from "@/lib/hooks";

/** "MM:SS" to the next payout round, ticking every second (prototype `[data-countdown]`). */
export function Countdown({ nextAt }: { nextAt: string }) {
  const now = useNow();
  // When a round passes, roll forward to the next top of the hour instead of sticking at 00:00.
  const t = rollForward(nextAt, now);
  return <span suppressHydrationWarning>{countdown(t, now)}</span>;
}

export function rollForward(nextAt: string, now: number, intervalMs = 3_600_000): number {
  let t = new Date(nextAt).getTime();
  while (t <= now) t += intervalMs;
  return t;
}

/** Progress ring for the current hour (prototype `ring`). */
export function Ring({ nextAt, intervalSec, size = 30, stroke = 3.5 }: { nextAt: string; intervalSec: number; size?: number; stroke?: number }) {
  const now = useNow();
  const r = (size - stroke) / 2,
    c = 2 * Math.PI * r;
  const frac = intervalFrac(rollForward(nextAt, now, intervalSec * 1000), intervalSec, now);
  return (
    <span className="ring">
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.1)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#4ADE80" strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} suppressHydrationWarning />
      </svg>
    </span>
  );
}
