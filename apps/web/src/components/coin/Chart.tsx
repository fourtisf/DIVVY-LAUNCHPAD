"use client";

import { useEffect, useRef } from "react";
import { ago, usd } from "@divvy/shared";

export interface ChartPoint {
  /** Unix seconds. */
  t: number;
  v: number;
}

/**
 * Market-cap line with glow, dashed grid, crosshair and tooltip (prototype `drawChart`).
 * Teal dots along the bottom mark hourly payouts once the coin is an hour old.
 */
export function Chart({ data, ticks, label }: { data: ChartPoint[]; ticks: boolean; label: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = cv.current,
      tipEl = tip.current;
    if (!canvas || !tipEl || data.length < 2) return;
    const values = data.map((d) => d.v);
    let paint: (hi?: number) => void = () => {};
    let X = (_i: number) => 0,
      Y = (_v: number) => 0,
      w = 0;
    const padL = 4,
      padR = 62,
      padT = 16,
      padB = 30;

    const setup = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const g = canvas.getContext("2d")!;
      g.scale(dpr, dpr);
      let min = Math.min(...values) * 0.9,
        max = Math.max(...values) * 1.06;
      if (max - min < 1) {
        min *= 0.9;
        max *= 1.1;
      }
      X = (i) => padL + ((w - padL - padR) * i) / (values.length - 1);
      Y = (v) => padT + (h - padT - padB) * (1 - (v - min) / (max - min));
      paint = (hi) => {
        g.clearRect(0, 0, w, h);
        g.font = "12px Satoshi, 'Plus Jakarta Sans', system-ui";
        g.lineWidth = 1;
        for (let k = 0; k <= 4; k++) {
          const v = min + ((max - min) * k) / 4,
            y = Math.round(Y(v)) + 0.5;
          g.strokeStyle = "rgba(134,239,172,.07)";
          g.setLineDash([2, 4]);
          g.beginPath();
          g.moveTo(padL, y);
          g.lineTo(w - padR, y);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = "#64786E";
          g.fillText(usd(v), w - padR + 10, y + 4);
        }
        if (ticks) {
          g.fillStyle = "#5EEAD4";
          const st = Math.max(3, Math.round(values.length / 14));
          for (let i = values.length - 1; i > 0; i -= st) {
            g.beginPath();
            g.arc(X(i), h - padB + 14, 2.6, 0, 7);
            g.fill();
          }
        }
        const grad = g.createLinearGradient(0, padT, 0, h - padB);
        grad.addColorStop(0, "rgba(74,222,128,.32)");
        grad.addColorStop(1, "rgba(74,222,128,0)");
        g.beginPath();
        values.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
        g.lineTo(X(values.length - 1), h - padB);
        g.lineTo(X(0), h - padB);
        g.closePath();
        g.fillStyle = grad;
        g.fill();
        g.save();
        g.shadowColor = "rgba(74,222,128,.7)";
        g.shadowBlur = 14;
        g.beginPath();
        values.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
        g.strokeStyle = "#4ADE80";
        g.lineWidth = 2.2;
        g.lineJoin = "round";
        g.stroke();
        g.restore();
        const li = hi ?? values.length - 1,
          lx = X(li),
          ly = Y(values[li]!);
        if (hi != null) {
          g.strokeStyle = "rgba(234,251,241,.25)";
          g.setLineDash([3, 3]);
          g.beginPath();
          g.moveTo(lx, padT);
          g.lineTo(lx, h - padB);
          g.stroke();
          g.setLineDash([]);
        }
        g.fillStyle = "rgba(74,222,128,.25)";
        g.beginPath();
        g.arc(lx, ly, 9, 0, 7);
        g.fill();
        g.fillStyle = "#EAFBF1";
        g.beginPath();
        g.arc(lx, ly, 3.8, 0, 7);
        g.fill();
      };
      paint();
    };
    setup();

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const i = Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left - padL) / (w - padL - padR)) * (values.length - 1))));
      paint(i);
      tipEl.style.display = "block";
      tipEl.style.left = X(i) + "px";
      tipEl.style.top = Y(values[i]!) + "px";
      const last = i === values.length - 1;
      tipEl.innerHTML = "";
      const b = document.createElement("b");
      b.textContent = usd(values[i]!);
      const s = document.createElement("span");
      s.className = "faint";
      s.textContent = last ? "now" : ago(data[i]!.t * 1000);
      tipEl.append(b, s);
    };
    const onLeave = () => {
      tipEl.style.display = "none";
      paint();
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", setup);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", setup);
    };
  }, [data, ticks]);

  return (
    <div className="chart-box">
      <canvas ref={cv} id="chart" role="img" aria-label={label} />
      <div className="chart-tip" id="tip" ref={tip} />
    </div>
  );
}
