// "Meet uspad" announcement image for X (16:9, 1600 x 900, rendered at 2x).
// Usage (repo root): node brand/uspad/src/meet.cjs brand/uspad
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DIR = process.argv[2];
const OUT = path.join(DIR, "social");
fs.mkdirSync(OUT, { recursive: true });
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const sized = (s, w) => s.replace(/ width="[^"]*" height="[^"]*"/, "").replace("<svg ", `<svg width="${w}" `);
const logo = (symbol) => `data:image/png;base64,${fs.readFileSync(path.join(DIR, "../../apps/web/public/stocks", `${symbol}.png`)).toString("base64")}`;

// Engraved wave lines, like the background of a share certificate (same as social.cjs).
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

// The six stocks that orbit the hero coin on the site, on a ring around the mark.
const CX = 1215;
const CY = 430;
const ORBIT = 262;
const orbit = ["NVDAx", "SPYx", "TSLAx", "AAPLx", "QQQx", "MSTRx"]
  .map((s, i) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    const x = CX + Math.cos(a) * ORBIT;
    const y = CY + Math.sin(a) * ORBIT;
    return `<div class="chip" style="left:${x}px;top:${y}px"><img src="${logo(s)}"><span>${s}</span></div>`;
  })
  .join("");

const steps = [
  ["1", "Launch", "Private bundle. No snipers, no dev buy."],
  ["2", "Trade", "1% fee per trade. Half goes to holders."],
  ["3", "Get paid", "Real stock tokens, every hour."],
]
  .map(([n, t, d]) => `<div class="step"><span class="n">${n}</span><div><b>${t}</b><p>${d}</p></div></div>`)
  .join("");

const css = `*{box-sizing:border-box}html,body{margin:0}body{background:#070B09;color:#EAFBF1;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.glow{background:linear-gradient(100deg,#B6FFD2,#4ADE80 45%,#D9F99D);-webkit-background-clip:text;background-clip:text;color:transparent}
.ring{position:absolute;border-radius:50%;transform:translate(-50%,-50%)}
.chip{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:9px}
.chip img{width:76px;height:76px;border-radius:50%;display:block;box-shadow:0 0 0 2px rgba(255,255,255,.22),0 14px 34px -10px rgba(0,0,0,.8),0 0 26px -6px rgba(74,222,128,.45)}
.chip span{font:600 15px Inter;color:#C9E8D6;letter-spacing:.01em;background:rgba(7,11,9,.72);border:1px solid rgba(134,239,172,.16);padding:3px 10px;border-radius:999px}
.pill{display:inline-flex;align-items:center;gap:9px;font:500 17px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.22);background:rgba(74,222,128,.06);padding:8px 16px;border-radius:999px}
.pill i{width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 12px #4ADE80}
.steps{display:flex;gap:16px}
.step{width:236px;display:flex;gap:14px;align-items:flex-start;padding:18px 18px 18px 16px;border-radius:20px;border:1px solid rgba(134,239,172,.14);background:linear-gradient(180deg,rgba(17,27,22,.9),rgba(11,17,14,.9))}
.step .n{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;font:600 16px 'Inter Display',Inter;color:#06210F;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8);box-shadow:inset 0 0 0 2px rgba(255,255,255,.45)}
.step b{display:block;font:600 19px 'Inter Display',Inter;letter-spacing:-.01em;margin:3px 0 4px}
.step p{margin:0;font:400 15px/1.4 Inter;color:#97ACA2}`;

const html = `<div style="width:1600px;height:900px;position:relative;overflow:hidden;background:
  radial-gradient(560px 480px at ${CX}px ${CY}px,rgba(74,222,128,.24),transparent 70%),
  radial-gradient(800px 460px at 260px -80px,rgba(94,234,212,.10),transparent 70%),
  radial-gradient(700px 300px at 900px 980px,rgba(74,222,128,.08),transparent 70%),
  linear-gradient(180deg,#0B130F,#070B09)">
  ${guilloche(1600, 900, 40, 13, 0.05)}
  <div class="ring" style="left:${CX}px;top:${CY}px;width:${ORBIT * 2}px;height:${ORBIT * 2}px;border:1px solid rgba(134,239,172,.16)"></div>
  <div class="ring" style="left:${CX}px;top:${CY}px;width:${ORBIT * 2 + 150}px;height:${ORBIT * 2 + 150}px;border:1px solid rgba(134,239,172,.07)"></div>
  <div class="ring" style="left:${CX}px;top:${CY}px;width:330px;height:330px;border:1px solid rgba(134,239,172,.12)"></div>
  <div style="position:absolute;left:${CX}px;top:${CY}px;transform:translate(-50%,-50%);filter:drop-shadow(0 34px 60px rgba(74,222,128,.38)) drop-shadow(0 0 26px rgba(74,222,128,.18))">${sized(read("mark.svg"), 270)}</div>
  ${orbit}
  <div style="position:absolute;left:96px;top:78px">${sized(read("lockup-dark.svg"), 170)}</div>
  <div style="position:absolute;left:96px;top:196px;width:760px">
    <span class="pill"><i></i>Meet uspad · the stock-dividend launchpad on Solana</span>
    <p style="margin:30px 0 0;font:600 80px/1.0 'Inter Display',Inter;letter-spacing:-.04em">Memecoins that pay you in <span class="glow">US stocks.</span></p>
    <p style="margin:26px 0 0;font:400 23px/1.45 Inter;color:#A9BDB3;max-width:660px">Launch a coin on Solana. Every trade buys tokenized stocks like NVDAx and SPYx for its holders, paid out every hour.</p>
  </div>
  <div class="steps" style="position:absolute;left:96px;top:640px">${steps}</div>
  <div style="position:absolute;left:96px;right:96px;bottom:44px;display:flex;justify-content:space-between;font:500 16px Inter;color:#6E857A">
    <span>uspad.fun · @uspadfun</span><span>Built on Raydium LaunchLab · Solana</span>
  </div>
</div>`;

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "meet-uspad-3200x1800.png"), clip: { x: 0, y: 0, width: 1600, height: 900 } });
  await b.close();
})();
