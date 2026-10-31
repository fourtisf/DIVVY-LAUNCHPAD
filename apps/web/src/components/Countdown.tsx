"use client";

import { countdown } from "@divvy/shared";
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
