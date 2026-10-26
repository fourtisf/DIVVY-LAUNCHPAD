// X (Twitter) profile photo and header banner for uspad.fun, plus a preview of how they sit together.
// Usage (repo root): node brand/uspad/src/social.cjs brand/uspad
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

const base = `*{box-sizing:border-box}html,body{margin:0}body{background:#070B09;color:#EAFBF1;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.glow{background:linear-gradient(100deg,#B6FFD2,#4ADE80 45%,#D9F99D);-webkit-background-clip:text;background-clip:text;color:transparent}`;

// 1000 x 1000 profile photo: the mark inside the circle X crops to, on a deep green tile.
const profile = `<div style="width:1000px;height:1000px;position:relative;overflow:hidden;background:radial-gradient(620px 560px at 50% 44%,#163A26 0%,#0C1D14 55%,#070B09 100%)">
  ${guilloche(1000, 1000, 46, 14, 0.05)}
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
    <div style="filter:drop-shadow(0 40px 70px rgba(74,222,128,.35)) drop-shadow(0 0 30px rgba(74,222,128,.18))">${sized(read("mark.svg"), 660)}</div>
  </div></div>`;

// 1500 x 500 header. X lays the profile photo over the lower left and crops a little off the top and
// bottom on phones, so everything sits right of x = 430 and between y = 80 and 420. No domain on the header (owner's call).
const header = `<div style="width:1500px;height:500px;position:relative;overflow:hidden;background:
  radial-gradient(520px 420px at 1210px 250px,rgba(74,222,128,.22),transparent 70%),
  radial-gradient(700px 400px at 300px -60px,rgba(94,234,212,.10),transparent 70%),
  linear-gradient(180deg,#0B130F,#070B09)">
  ${guilloche(1500, 500, 30, 12, 0.055)}
  <div style="position:absolute;left:1210px;top:250px;width:620px;height:620px;transform:translate(-50%,-50%);border-radius:50%;border:1px solid rgba(134,239,172,.10)"></div>
  <div style="position:absolute;left:1210px;top:250px;width:470px;height:470px;transform:translate(-50%,-50%);border-radius:50%;border:1px solid rgba(134,239,172,.14)"></div>
  <div style="position:absolute;left:1210px;top:250px;transform:translate(-50%,-50%);filter:drop-shadow(0 34px 60px rgba(74,222,128,.35)) drop-shadow(0 0 24px rgba(74,222,128,.15))">${sized(read("mark.svg"), 300)}</div>
  <div style="position:absolute;left:470px;top:250px;transform:translateY(-50%)">
    <p style="margin:0;font:600 54px/1.04 'Inter Display',Inter;letter-spacing:-.035em">Memecoins that pay <span class="glow">us.</span><br>In <span class="glow">US stocks.</span></p>
    <p style="margin:18px 0 0;font:500 19px Inter;color:#97ACA2;letter-spacing:.005em">Launch on Solana · Hourly stock dividends</p>
  </div></div>`;

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ deviceScaleFactor: 2 });
  const shot = async (html, w, h, file) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${base}</style>${html}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width: w, height: h } });
  };
  // Rendered at 2x for crispness; the 1x sizes are made from these below.
  await shot(profile, 1000, 1000, "x-profile-2000.png");
  await shot(header, 1500, 500, "x-header-3000x1000.png");

  // Preview: the header with the profile photo where X puts it (desktop column 600 px wide, photo
  // 134 px, 16 px from the left, overlapping the header's bottom by half).
  const hdr = fs.readFileSync(path.join(OUT, "x-header-3000x1000.png")).toString("base64");
  const pfp = fs.readFileSync(path.join(OUT, "x-profile-2000.png")).toString("base64");
  const preview = `<div style="width:1340px;padding:40px;display:flex;gap:40px;background:#000">
   ${[["Foto bulat", "50%"], ["Foto persegi (akun organisasi)", "16px"]].map(([label, radius]) => `<div style="width:590px">
    <p style="font:500 15px Inter;color:#97ACA2;margin:0 0 12px">${label}</p>
    <div style="border:1px solid #2F3336;border-radius:16px;overflow:hidden;background:#000">
      <img src="data:image/png;base64,${hdr}" style="width:590px;height:197px;display:block">
      <div style="position:relative;height:150px;padding:0 16px">
        <img src="data:image/png;base64,${pfp}" style="position:absolute;left:16px;top:-66px;width:132px;height:132px;border-radius:${radius};border:4px solid #000">
        <div style="position:absolute;left:16px;top:80px"><div style="font:700 20px Inter;color:#E7E9EA">uspad.fun</div>
        <div style="font:400 15px Inter;color:#71767B;margin-top:2px">Memecoins that pay us. In US stocks.</div></div>
      </div></div></div>`).join("")}</div>`;
  await shot(preview, 1340, 470, "x-preview.png");
  await b.close();
})();
