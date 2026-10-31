/** Card sparkline (prototype `sparkSvg`). */
export function Spark({ data, up, id }: { data: number[]; up: boolean; id: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data),
    max = Math.max(...data),
    w = 84,
    h = 30;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - (max - min ? (v - min) / (max - min) : 0.5) * (h - 6)] as const);
  const line = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  // The up/down colours follow the visitor's setting (additions.css, --up and --down).
  const col = up ? "var(--up)" : "var(--down)";
  const gid = "g" + id;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: col }} stopOpacity=".3" />
          <stop offset="1" style={{ stopColor: col }} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" style={{ stroke: col }} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
