/** Card sparkline (prototype `sparkSvg`). */
export function Spark({ data, up, id }: { data: number[]; up: boolean; id: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data),
    max = Math.max(...data),
    w = 84,
    h = 30;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - (max - min ? (v - min) / (max - min) : 0.5) * (h - 6)] as const);
  const line = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const col = up ? "#4ADE80" : "#FF6B81";
  const gid = "g" + id;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity=".3" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
