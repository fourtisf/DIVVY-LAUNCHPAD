// hwai.ai share image (the site's opengraph-image.png and twitter-image.png), X profile photo, X header,
// and the PNG icons: mark-512.png, app-icon-512.png, apple-icon-180.png and favicon-32.png.
// Usage (repo root): node brand/hwai/src/social.cjs brand/hwai
// Same layout as brand/uspad/src/social.cjs; the headline is the Chinese hero line with the English one
// under it. Noto Sans SC comes from Google Fonts, so this needs network access.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DIR = process.argv[2];
const OUT = path.join(DIR, "social");
fs.mkdirSync(OUT, { recursive: true });
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const sized = (s, w) => s.replace(/ width="[^"]*" height="[^"]*"/, "").replace("<svg ", `<svg width="${w}" `);

// Engraved wave lines, like the background of a share certificate. Kept faint.
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

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;900&family=Plus+Jakarta+Sans:wght@500;600&display=block">`;
const base = `*{box-sizing:border-box}html,body{margin:0}body{background:#070B09;color:#EAFBF1;font-family:"Plus Jakarta Sans","Noto Sans SC",sans-serif;-webkit-font-smoothing:antialiased}
.zh{font-family:"Noto Sans SC",sans-serif;font-weight:900;letter-spacing:.01em}
.glow{background:linear-gradient(100deg,#B6FFD2,#4ADE80 45%,#D9F99D);-webkit-background-clip:text;background-clip:text;color:transparent}`;
const bg = (w, h, cx, cy) => `radial-gradient(520px 440px at ${cx}px ${cy}px,rgba(74,222,128,.22),transparent 70%),
  radial-gradient(700px 400px at ${w / 6}px -70px,rgba(94,234,212,.10),transparent 70%),linear-gradient(180deg,#0B130F,#070B09)`;
const coin = (cx, cy, size, rings) => `${rings.map((r, i) => `<div style="position:absolute;left:${cx}px;top:${cy}px;width:${r}px;height:${r}px;transform:translate(-50%,-50%);border-radius:50%;border:1px solid rgba(134,239,172,${i ? 0.14 : 0.1})"></div>`).join("")}
  <div style="position:absolute;left:${cx}px;top:${cy}px;transform:translate(-50%,-50%);filter:drop-shadow(0 34px 60px rgba(74,222,128,.35)) drop-shadow(0 0 24px rgba(74,222,128,.15))">${sized(read("mark.svg"), size)}</div>`;

const profile = `<div style="width:1000px;height:1000px;position:relative;overflow:hidden;background:radial-gradient(620px 560px at 50% 44%,#163A26 0%,#0C1D14 55%,#070B09 100%)">
  ${guilloche(1000, 1000, 46, 14, 0.05)}
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
    <div style="filter:drop-shadow(0 40px 70px rgba(74,222,128,.35)) drop-shadow(0 0 30px rgba(74,222,128,.18))">${sized(read("mark.svg"), 660)}</div>
  </div></div>`;

// X lays the profile photo over the lower left of the header, so the text starts at x = 470.
const header = `<div style="width:1500px;height:500px;position:relative;overflow:hidden;background:${bg(1500, 500, 1210, 250)}">
  ${guilloche(1500, 500, 30, 12, 0.055)}
  ${coin(1210, 250, 300, [620, 470])}
  <div style="position:absolute;left:470px;top:250px;transform:translateY(-50%)">
    <p class="zh" style="margin:0;font-size:64px;line-height:1.15">土狗也分红，<br><span class="glow">分的是美股。</span></p>
    <p style="margin:18px 0 0;font-weight:500;font-size:20px;color:#97ACA2">Memecoins that pay you real stock dividends, every hour.</p>
  </div></div>`;

const og = `<div style="width:1200px;height:630px;position:relative;overflow:hidden;background:${bg(1200, 630, 935, 330)}">
  ${guilloche(1200, 630, 36, 12, 0.05)}
  ${coin(935, 330, 300, [560, 420])}
  <div style="position:absolute;left:72px;top:66px">${sized(read("lockup-ai-dark.svg"), 250)}</div>
  <div style="position:absolute;left:72px;top:200px;width:660px">
    <p class="zh" style="margin:0;font-size:76px;line-height:1.15">土狗也分红，<br><span class="glow">分的是美股。</span></p>
    <p style="margin:26px 0 0;font-weight:600;font-size:26px;letter-spacing:-.01em">Memecoins that pay you real stock dividends.</p>
    <p class="zh" style="margin:10px 0 0;font-weight:500;font-size:22px;color:#97ACA2">Solana 发币 · 每小时美股分红</p>
  </div></div>`;

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ deviceScaleFactor: 2 });
  const shot = async (html, w, h, file) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><meta charset="utf-8">${FONTS}<style>${base}</style>${html}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: w, height: h } });
  };
  await shot(profile, 1000, 1000, "x-profile-2000.png");
  await shot(header, 1500, 500, "x-header-3000x1000.png");
  await shot(og, 1200, 630, "og-2400x1260.png");
  // 1x copies, scaled down by the browser.
  const down = async (src, w, h, file) => {
    const data = fs.readFileSync(path.join(OUT, src)).toString("base64");
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0"><img src="data:image/png;base64,${data}" style="width:${w}px;height:${h}px;display:block">`);
    await p.screenshot({ path: path.join(OUT, file) });
    await p.close();
  };
  await down("x-profile-2000.png", 1000, 1000, "x-profile-1000.png");
  await down("x-profile-2000.png", 400, 400, "x-profile-400.png");
  await down("x-header-3000x1000.png", 1500, 500, "x-header-1500x500.png");
  await down("og-2400x1260.png", 1200, 630, "og-1200x630.png");
  // Icons, transparent where the SVG is.
  const png = async (svgFile, file, size) => {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${sized(read(svgFile), size)}`);
    await p.screenshot({ path: path.join(DIR, file), omitBackground: true });
    await p.close();
  };
  await png("mark.svg", "mark-512.png", 512);
  await png("app-icon.svg", "app-icon-512.png", 512);
  await png("app-icon.svg", "apple-icon-180.png", 180);
  await png("mark.svg", "favicon-32.png", 32);
  await b.close();
})();
