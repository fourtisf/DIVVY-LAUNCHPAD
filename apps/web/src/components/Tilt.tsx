"use client";

import { useEffect } from "react";

/**
 * Pointer-driven 3D tilt for every `.tilt` element (prototype "3D tilt for cards"): up to 9° on X and
 * 11° on Y, with the inner blocks lifted by CSS while `.on`. Off for touch and reduced motion.
 */
export function TiltController() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    let tiltEl: HTMLElement | null = null;
    const reset = () => {
      if (!tiltEl) return;
      tiltEl.classList.remove("on");
      tiltEl.style.transform = "";
      tiltEl = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".tilt") ?? null;
      if (tiltEl && tiltEl !== el) reset();
      if (!el) return;
      tiltEl = el;
      const r = el.getBoundingClientRect(),
        x = (e.clientX - r.left) / r.width,
        y = (e.clientY - r.top) / r.height;
      el.classList.add("on");
      el.style.setProperty("--mx", x * 100 + "%");
      el.style.setProperty("--my", y * 100 + "%");
      el.style.transform = `perspective(1000px) rotateX(${(0.5 - y) * 9}deg) rotateY(${(x - 0.5) * 11}deg) translateY(-4px)`;
    };
    document.addEventListener("pointermove", move);
    return () => {
      document.removeEventListener("pointermove", move);
      reset();
    };
  }, []);
  return null;
}
