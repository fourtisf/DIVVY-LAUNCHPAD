// Header image for the X article "What is uspad, and how it works" (5:2, as X recommends; 1500 x 600 at 2x).
// Usage (repo root): node brand/uspad/src/article.cjs brand/uspad
const fs = require("fs");
const path = require("path");
const { sized, guilloche, orbitScene, render } = require("./lib.cjs");

const DIR = process.argv[2];
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const W = 1500;
const H = 600;
const CX = 1170;
const CY = 300;

const flow = ["Launch", "Trade 1%", "Paid hourly", "Graduate at 85 SOL"]
  .map((t, i) => `${i ? '<span class="arrow">→</span>' : ""}<span class="flow">${t}</span>`)
  .join("");

const css = `.flow{font:500 16px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.16);background:rgba(17,27,22,.85);padding:8px 14px;border-radius:12px}
.arrow{color:#4ADE80;font:600 16px Inter;margin:0 8px}`;

const html = `<div style="width:${W}px;height:${H}px;position:relative;overflow:hidden;background:
  radial-gradient(460px 400px at ${CX}px ${CY}px,rgba(74,222,128,.24),transparent 70%),
  radial-gradient(700px 360px at 220px -60px,rgba(94,234,212,.10),transparent 70%),
  linear-gradient(180deg,#0B130F,#070B09)">
  ${guilloche(W, H, 28, 12, 0.05)}
  ${orbitScene(DIR, read("mark.svg"), { cx: CX, cy: CY, orbit: 205, markSize: 200, chip: 60 })}
  <div style="position:absolute;left:84px;top:64px">${sized(read("lockup-dark.svg"), 140)}</div>
  <div style="position:absolute;left:84px;top:150px;width:700px">
    <span class="pill"><i></i>uspad, explained</span>
    <p style="margin:22px 0 0;font:600 72px/1.0 'Inter Display',Inter;letter-spacing:-.04em">What is <span class="glow">uspad?</span></p>
    <p style="margin:18px 0 0;font:400 22px/1.45 Inter;color:#A9BDB3;max-width:620px">Memecoins that pay their holders in US stocks, every hour. Here's how it works.</p>
  </div>
  <div style="position:absolute;left:84px;top:470px;display:flex;align-items:center">${flow}</div>
</div>`;

render(DIR, "article-what-is-uspad-3000x1200.png", W, H, css, html);
