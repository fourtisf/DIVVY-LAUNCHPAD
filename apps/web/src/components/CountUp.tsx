"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/hooks";

// The prototype counts up once per visit, the first time the board renders.
let counted = false;

/** Renders the final value on the server; on the first client visit, counts up from 0 over 1.2 s. */
export function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const [anim, setAnim] = useState<number | null>(null);
  useEffect(() => {
    if (counted || prefersReducedMotion()) return;
    const t0 = performance.now(),
      d = 1200;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / d);
      if (k >= 1) {
        counted = true;
        setAnim(null);
        return;
      }
      setAnim(1 - Math.pow(1 - k, 3));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <>{format(anim === null ? value : value * anim)}</>;
}
