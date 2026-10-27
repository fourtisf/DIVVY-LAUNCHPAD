// Shared pieces of the uspad social images (meet.cjs, article.cjs).
const fs = require("fs");
const path = require("path");

const sized = (svg, w) => svg.replace(/ width="[^"]*" height="[^"]*"/, "").replace("<svg ", `<svg width="${w}" `);

/** The official stock token icon the site uses (apps/web/public/stocks), as a data URI. */
const stockLogo = (dir, symbol) =>
  `data:image/png;base64,${fs.readFileSync(path.join(dir, "../../apps/web/public/stocks", `${symbol}.png`)).toString("base64")}`;

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
 */
async function renderVideo({ out, width, height, fps, duration, css, html, stills }) {
  const { chromium } = require("playwright");
  const { spawn } = require("child_process");
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${baseCss}${motionCss}${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const seek = (ms) => page.evaluate((t) => document.getAnimations().forEach((a) => (a.currentTime = t)), ms);
  if (stills) {
    for (const t of stills.times) {
      await seek(t * 1000);
      await page.screenshot({ path: path.join(stills.dir, `t${String(t).replace(".", "_")}.png`) });
    }
    return b.close();
  }
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round(duration * fps);
  for (let f = 0; f < frames; f++) {
    await seek((f / fps) * 1000);
    const png = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % (fps * 5) === 0) process.stdout.write(`${(f / fps).toFixed(0)}s `);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
  await b.close();
}

module.exports = { sized, stockLogo, guilloche, orbitScene, baseCss, motionCss, render, renderVideo };
