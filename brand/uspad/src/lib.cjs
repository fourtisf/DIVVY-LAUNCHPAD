// Shared pieces of the uspad social images (meet.cjs, article.cjs).
const fs = require("fs");
const path = require("path");

const sized = (svg, w) => svg.replace(/ width="[^"]*" height="[^"]*"/, "").replace("<svg ", `<svg width="${w}" `);

/** The official stock token icon the site uses (apps/web/public/stocks), as a data URI. */
const stockLogo = (dir, symbol) =>
  `data:image/png;base64,${fs.readFileSync(path.join(dir, "../../apps/web/public/stocks", `${symbol}.png`)).toString("base64")}`;

/** The six featured stocks as the 3D scenes take them, with the colours the site gives them (apps/api/src/mock/data.ts). */
const stockArt = (dir) =>
  [
    ["NVDAx", "NV", "Nvidia", "#76B900", "#0D2200"],
    ["SPYx", "SPY", "S&P 500", "#6D88FF", "#0B1440"],
    ["TSLAx", "TS", "Tesla", "#EF5A65", "#3A0A10"],
    ["AAPLx", "AP", "Apple", "#E1E5EA", "#1B1F27"],
    ["QQQx", "QQQ", "Nasdaq 100", "#3CCBEB", "#06303A"],
    ["MSTRx", "MS", "Strategy", "#F7931A", "#331A00"],
  ].map(([symbol, mono, name, bg, fg]) => ({ symbol, mono, name, bg, fg, logo: stockLogo(dir, symbol) }));

/** A three.js scene in this folder (token3d.ts), bundled for the page with the repo's esbuild and the web app's three. */
async function bundle3d(file) {
  const root = path.resolve(__dirname, "../../..");
  const esbuild = require(path.join(root, "node_modules/.pnpm/node_modules/esbuild"));
  const r = await esbuild.build({
    entryPoints: [path.join(__dirname, file)],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    nodePaths: [path.join(root, "apps/web/node_modules")],
    logLevel: "error",
  });
  return r.outputFiles[0].text;
}

/** Engraved wave lines, like the background of a share certificate. */
function guilloche(width, height, lines, amp, opacity) {
  let d = "";
  for (let i = 0; i < lines; i++) {
    const y0 = (height / (lines - 1)) * i;
    const ph = i * 0.42;
    const pts = [];
    for (let x = -20; x <= width + 20; x += 6) pts.push(`${x.toFixed(1)} ${(y0 + Math.sin(x / 95 + ph) * amp + Math.sin(x / 37 - ph * 1.7) * amp * 0.35).toFixed(1)}`);
    d += `M${pts.join("L")}`;
  }
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="position:absolute;inset:0"><path d="${d}" fill="none" stroke="#86EFAC" stroke-opacity="${opacity}" stroke-width="1"/></svg>`;
}

/** The Koin belah mark with rings and the six featured stocks orbiting it, centred on (cx, cy). */
function orbitScene(dir, mark, { cx, cy, orbit, markSize, chip }) {
  const chips = ["NVDAx", "SPYx", "TSLAx", "AAPLx", "QQQx", "MSTRx"]
    .map((s, i) => {
      const a = (-90 + i * 60) * (Math.PI / 180);
      return `<div class="chip" style="left:${cx + Math.cos(a) * orbit}px;top:${cy + Math.sin(a) * orbit}px"><img src="${stockLogo(dir, s)}" style="width:${chip}px;height:${chip}px"><span>${s}</span></div>`;
    })
    .join("");
  const ring = (d, o) => `<div class="ring" style="left:${cx}px;top:${cy}px;width:${d}px;height:${d}px;border:1px solid rgba(134,239,172,${o})"></div>`;
  return `${ring(orbit * 2, 0.16)}${ring(orbit * 2 + 150, 0.07)}${ring(markSize * 1.22, 0.12)}
  <div style="position:absolute;left:${cx}px;top:${cy}px;transform:translate(-50%,-50%);filter:drop-shadow(0 34px 60px rgba(74,222,128,.38)) drop-shadow(0 0 26px rgba(74,222,128,.18))">${sized(mark, markSize)}</div>
  ${chips}`;
}

const baseCss = `*{box-sizing:border-box}html,body{margin:0}body{background:#070B09;color:#EAFBF1;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.glow{background:linear-gradient(100deg,#B6FFD2,#4ADE80 45%,#D9F99D);-webkit-background-clip:text;background-clip:text;color:transparent}
.ring{position:absolute;border-radius:50%;transform:translate(-50%,-50%)}
.chip{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:9px}
.chip img{border-radius:50%;display:block;box-shadow:0 0 0 2px rgba(255,255,255,.22),0 14px 34px -10px rgba(0,0,0,.8),0 0 26px -6px rgba(74,222,128,.45)}
.chip span{font:600 15px Inter;color:#C9E8D6;letter-spacing:.01em;background:rgba(7,11,9,.72);border:1px solid rgba(134,239,172,.16);padding:3px 10px;border-radius:999px}
.pill{display:inline-flex;align-items:center;gap:9px;font:500 17px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.22);background:rgba(74,222,128,.06);padding:8px 16px;border-radius:999px}
.pill i{width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 12px #4ADE80}`;

/** Renders `html` at 2x into DIR/social/<file>. */
async function render(dir, file, width, height, css, html) {
  const { chromium } = require("playwright");
  fs.mkdirSync(path.join(dir, "social"), { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width, height } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${baseCss}${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, "social", file), clip: { x: 0, y: 0, width, height } });
  await b.close();
}

/** Scene fades and entrances for the videos; renderVideo seeks them frame by frame. */
const motionCss = `.scene{position:absolute;inset:0;opacity:0;animation:sc var(--d) linear var(--s) both}
.scene.last{animation-name:scLast}
@keyframes sc{0%{opacity:0;transform:scale(1.03)}6%{opacity:1;transform:none}94%{opacity:1;transform:none}100%{opacity:0;transform:scale(.99)}}
@keyframes scLast{0%{opacity:0;transform:scale(1.03)}8%{opacity:1;transform:none}100%{opacity:1;transform:none}}
.in{animation:rise .8s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o,0s)) both}
@keyframes rise{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
.pop{animation:pop .7s cubic-bezier(.34,1.56,.64,1) calc(var(--s) + var(--o,0s)) both}
@keyframes pop{from{opacity:0;transform:translate(-50%,-50%) scale(.3)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`;

/**
 * Renders `html` (width x height, CSS animations timed from 0 s) to an H.264 MP4 at `out`. Every
 * animation is paused and seeked with the Web Animations API, so each frame is exact however slow the
 * screenshot. With `stills` (a folder and a list of times), it saves those frames as PNGs instead.
 *
 * For WebGL: `args` go to Chromium, `prepare(page)` runs once the page is set up (e.g. to start a
 * three.js scene), and `frameHook` names a window function called with each frame's time in seconds
 * after the seek. `workers` render that many slices of the video at once, joined without re-encoding.
 * `shutter` ({ samples, angle }) gives film motion blur: each frame is the average of `samples` renders
 * spread over the time a shutter of that angle is open, centred on the frame. `only` ([[start, end], …]
 * in seconds) renders just those spans, one after the other, to re-render a few scenes of a long video.
 */
async function renderVideo({ out, width, height, fps, duration, css, html, stills, args = [], prepare, frameHook, workers = 1, crf = 18, shutter, only }) {
  const { chromium } = require("playwright");
  const { spawn, spawnSync } = require("child_process");
  const open = async () => {
    const b = await chromium.launch({ args });
    const page = await b.newPage({ viewport: { width, height } });
    // A software-WebGL frame can take far longer than Playwright's 30 s default while the workers start up together.
    page.setDefaultTimeout(300_000);
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${baseCss}${motionCss}${css}</style>${html}`);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    if (prepare) await prepare(page);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
    const seek = (ms) =>
      page.evaluate(
        ([t, hook]) => {
          document.getAnimations().forEach((a) => (a.currentTime = t));
          if (hook) window[hook](t / 1000);
        },
        [ms, frameHook || null],
      );
    return { b, page, seek };
  };
  if (stills) {
    const { b, page, seek } = await open();
    for (const t of stills.times) {
      await seek(t * 1000);
      await page.screenshot({ path: path.join(stills.dir, `t${String(t).replace(".", "_")}.png`) });
    }
    return b.close();
  }
  const all = Array.from({ length: Math.round(duration * fps) }, (_, f) => f);
  const frames = only ? all.filter((f) => only.some(([a, b]) => f >= Math.round(a * fps) && f < Math.round(b * fps))) : all;
  const samples = shutter && shutter.samples > 1 ? shutter.samples : 1;
  const shutterOpen = samples > 1 ? shutter.angle / 360 / fps : 0;
  const blur = samples > 1 ? ["-vf", `tmix=frames=${samples}:weights=${Array(samples).fill(1).join(" ")},select=eq(mod(n\\,${samples})\\,${samples - 1}),setpts=N/(${fps}*TB)`, "-r", String(fps)] : [];
  const n = Math.max(1, workers);
  const per = Math.ceil(frames.length / n);
  const parts = Array.from({ length: n }, (_, w) => (n === 1 ? out : `${out}.part${w}.mp4`));
  let done = 0;
  await Promise.all(
    parts.map(async (part, w) => {
      const { b, page, seek } = await open();
      const ff = spawn(
        "ffmpeg",
        ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps * samples), "-i", "-", ...blur, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-g", String(fps * 2), "-movflags", "+faststart", part],
        { stdio: ["pipe", "inherit", "inherit"] },
      );
      for (const f of frames.slice(w * per, (w + 1) * per)) {
        for (let j = 0; j < samples; j++) {
          const t = f / fps + (samples > 1 ? shutterOpen * (j / (samples - 1) - 0.5) : 0);
          await seek(Math.max(0, t) * 1000);
          const png = await page.screenshot({ type: "png" });
          if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
        }
        if (++done % (fps * 5) === 0) process.stdout.write(`${(done / fps).toFixed(0)}s `);
      }
      ff.stdin.end();
      await new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
      await b.close();
    }),
  );
  if (n === 1) return;
  const list = `${out}.parts.txt`;
  fs.writeFileSync(list, parts.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n"));
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { stdio: "inherit" });
  [list, ...parts].forEach((p) => fs.rmSync(p, { force: true }));
  if (r.status !== 0) throw new Error(`ffmpeg concat exited ${r.status}`);
}

module.exports = { sized, stockLogo, stockArt, bundle3d, guilloche, orbitScene, baseCss, motionCss, render, renderVideo };
