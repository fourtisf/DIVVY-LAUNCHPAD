// Header banner for $USPAD's token pages (3:1, 1500 x 500 and 3000 x 1000, as DEX Screener and the like
// ask for): the ticker, what it is, and the $USPAD coin with the six stock coins in orbit, the trailer's
// shot (token3d.ts). It names the ticker only: no contract address (owner request 2026-10-28).
// Usage (repo root): node brand/uspad/src/token-banner.cjs brand/uspad
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { stockArt, bundle3d, guilloche } = require("./lib.cjs");

const DIR = process.argv[2];
const OUT = path.join(DIR, "social");
const W = 1500;
const H = 500;
// The 3D shot, framed as a 960 x 540 shot with its coin at (CX, CY), on a canvas 1.5 times that so the
// stock coins near the edges aren't cut.
const ZOOM = 1 / 1.5;
const C3 = { w: 1440, h: 810, left: 350, top: -92 };
const CX = 1070;
const CY = 225;

const css = `*{box-sizing:border-box}html,body{margin:0;background:#050806}body{width:${W}px;height:${H}px;overflow:hidden;color:#EAFBF1;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.bn{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:
  radial-gradient(430px 330px at ${CX}px ${CY}px,rgba(74,222,128,.20),transparent 70%),
  radial-gradient(760px 420px at 180px -120px,rgba(94,234,212,.08),transparent 70%),
  linear-gradient(180deg,#0A120E,#050806)}
.ring{position:absolute;left:${CX}px;top:${CY}px;border-radius:50%;transform:translate(-50%,-50%);border:1px solid rgba(134,239,172,.10)}
.c3d canvas{position:absolute;left:${C3.left}px;top:${C3.top}px;width:${C3.w}px;height:${C3.h}px;display:block}
.c3d canvas.glow{filter:blur(18px) brightness(.95) saturate(1.6);mix-blend-mode:screen}
.txt{position:absolute;left:96px;top:50%;transform:translateY(-52%)}
.tk{margin:0;font:700 132px/1 'Inter Display',Inter;letter-spacing:-.045em;background:linear-gradient(180deg,#F4FFF9 0%,#B8F7CF 55%,#3FCB7A 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 30px rgba(74,222,128,.30))}
.sub{margin:22px 0 0;font:500 27px/1.3 Inter;color:#B4C8BE;letter-spacing:-.005em}
.sub b{font-weight:600;background:linear-gradient(100deg,#B6FFD2,#4ADE80 45%,#D9F99D);-webkit-background-clip:text;background-clip:text;color:transparent}
.pill{display:inline-flex;align-items:center;gap:11px;margin-top:26px;font:500 19px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.24);background:rgba(74,222,128,.07);padding:8px 18px;border-radius:999px}
.pill i{width:9px;height:9px;border-radius:50%;background:#4ADE80;box-shadow:0 0 12px #4ADE80}
.vignette{position:absolute;inset:0;background:radial-gradient(130% 120% at 50% 50%,transparent 62%,rgba(0,0,0,.55))}`;

const html = `<div class="bn">
  ${guilloche(W, H, 30, 12, 0.045)}
  <div class="ring" style="width:620px;height:620px"></div>
  <div class="ring" style="width:470px;height:470px;border-color:rgba(134,239,172,.14)"></div>
  <div class="c3d"><canvas id="c3d" width="${C3.w * 2}" height="${C3.h * 2}"></canvas><canvas id="c3dGlow" class="glow" width="${C3.w / 2}" height="${C3.h / 2}"></canvas></div>
  <div class="vignette"></div>
  <div class="txt">
    <p class="tk">$USPAD</p>
    <p class="sub">Memecoins that pay their holders<br>in <b>US stocks</b>, every hour.</p>
    <span class="pill"><i></i>The token of uspad.fun, on Solana</span>
  </div>
</div>`;

(async () => {
  const js = await bundle3d("token3d.ts");
  // WebGL in headless Chromium without a GPU.
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>${html}`);
  await page.addScriptTag({ content: js });
  // The trailer's orbit, 3 s in: every stock coin in, $USPAD turned a little to the light.
  await page.evaluate(async ({ stocks, zoom }) => {
    const frame = await window.token3d.init(document.getElementById("c3d"), stocks, { macro: [-40, 1], reveal: [-30, 1], orbit: [0, 6], end: [-20, 1] }, { glow: document.getElementById("c3dGlow"), zoom });
    frame(3.0);
  }, { stocks: stockArt(DIR), zoom: ZOOM });
  const big = path.join(OUT, "uspad-token-header-3000x1000.png");
  await page.screenshot({ path: big });
  await b.close();
  await new Promise((r, j) => require("child_process").execFile("convert", [big, "-resize", "1500x500", path.join(OUT, "uspad-token-header-1500x500.png")], (e) => (e ? j(e) : r())));
  for (const f of ["uspad-token-header-3000x1000.png", "uspad-token-header-1500x500.png"]) console.log(f, `${(fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2)} MB`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
