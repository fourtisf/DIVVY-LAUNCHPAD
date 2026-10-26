"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DividendAsset } from "@divvy/shared";
import type { StockArt } from "@/three/scenes";

export const toArt = (a: DividendAsset): StockArt => ({ symbol: a.symbol, name: a.name, mono: a.mono, bg: a.chipBg, fg: a.chipFg });

type Load = () => Promise<typeof import("@/three/scenes")>;
const load: Load = () => import("@/three/scenes");

/**
 * Mounts a three.js scene into `ref` on the client only. `three` is fetched with a dynamic import
 * after mount, never during SSR. Returns whether WebGL is available (null until known).
 */
export function useScene(start: (host: HTMLElement, m: Awaited<ReturnType<Load>>) => Promise<() => void>, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"pending" | "ready" | "fallback">("pending");
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const m = await load();
      if (cancelled || !ref.current) return;
      if (!m.hasWebGL()) return setState("fallback");
      const s = await start(ref.current, m);
      if (cancelled) s();
      else {
        stop = s;
        setState("ready");
      }
    })().catch(() => !cancelled && setState("fallback"));
    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, state };
}

/** Flipping coin on the coin page (front: meme picture, back: dividend stock). */
export function CoinFlip3D({ src, back, label, title }: { src: string; back: DividendAsset | undefined; label: string; title: string }) {
  const { ref, state } = useScene((host, m) => m.coinScene(host, src, back ? toArt(back) : null, { label }), [src, back?.symbol, label]);
  return (
    <div className="coin3d" ref={ref} title={title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {state !== "ready" && <img src={src} alt="" />}
    </div>
  );
}

/** Spinning coin in the launch modal. */
export function CoinSpin3D({ src, back, label }: { src: string; back: DividendAsset | undefined; label: string }) {
  const { ref, state } = useScene((host, m) => m.coinScene(host, src, back ? toArt(back) : null, { mode: "spin", label }), [src, back?.symbol, label]);
  return (
    <div className="mcoin" ref={ref}>
      {state === "fallback" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: 110, height: 110, borderRadius: "50%", margin: "30px auto", boxShadow: "0 0 0 6px var(--g)" }} />
      )}
    </div>
  );
}

/** The hero stage: 3D coin with orbiting stocks, or the CSS fallback coin without WebGL. */
export function HeroStage({ featured, children }: { featured: DividendAsset[]; children: ReactNode }) {
  const { ref, state } = useScene((host, m) => m.heroScene(host, featured.map(toArt)), [featured.map((f) => f.symbol).join()]);
  return (
    <div className="stage" id="stage" ref={ref} aria-label="A 3D Divvy coin with stock tokens orbiting around it">
      {state === "fallback" && <div className="fallback-coin" />}
      <div className="halo" />
      <div className="floor" />
      {children}
    </div>
  );
}
