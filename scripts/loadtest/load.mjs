// Open-loop load: RPS requests per second for DUR seconds, spread over many client IPs (X-Forwarded-For),
// mixing the board's real requests. Prints latency percentiles and status counts.
const BASE = process.env.BASE ?? "http://127.0.0.1:4100";
const RPS = Number(process.env.RPS ?? 50), DUR = Number(process.env.DUR ?? 30);
const paths = [
  "/api/coins?sort=trending&limit=24", "/api/coins?sort=new&limit=24", "/api/coins?sort=payers&limit=24", "/api/coins?sort=graduate&limit=24",
  "/api/coins?sort=trending&pays=NVDAx&limit=24", "/api/coins?sort=trending&q=load%2012&limit=24", "/api/stats", "/api/config",
  "/api/coins/LDBAA", "/api/coins/LDZZA", "/api/payouts?limit=60",
];
const lat = [], codes = {};
let inflight = 0, maxInflight = 0;
const one = async (i) => {
  const p = paths[i % paths.length];
  const t = performance.now();
  inflight++; maxInflight = Math.max(maxInflight, inflight);
  try {
    const r = await fetch(BASE + p, { headers: { "x-forwarded-for": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` } });
    await r.arrayBuffer();
    codes[r.status] = (codes[r.status] ?? 0) + 1;
  } catch { codes.err = (codes.err ?? 0) + 1; }
  inflight--;
  lat.push(performance.now() - t);
};
const start = performance.now(); const jobs = [];
for (let i = 0; i < RPS * DUR; i++) {
  const due = start + (i * 1000) / RPS;
  const wait = due - performance.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  jobs.push(one(i));
}
await Promise.all(jobs);
lat.sort((a, b) => a - b);
const q = (x) => lat[Math.min(lat.length - 1, Math.floor(x * lat.length))].toFixed(1);
console.log(JSON.stringify({ rps: RPS, seconds: DUR, requests: lat.length, achievedRps: +(lat.length / ((performance.now() - start) / 1000)).toFixed(1), p50ms: q(0.5), p95ms: q(0.95), p99ms: q(0.99), maxMs: lat.at(-1).toFixed(1), maxInflight, codes }));
