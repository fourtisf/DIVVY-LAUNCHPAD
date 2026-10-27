// "How uspad works" banners: the path from a launch to an hourly stock dividend, and where each trade's
// 1% goes. 16:9 for X posts (1600 x 900) and 4:5 for mobile feeds and Telegram (1080 x 1350), at 2x.
// Usage (repo root): node brand/uspad/src/how.cjs brand/uspad
// Figures are the site's (packages/shared/src/params.ts fee split, MIN_HOLDER_USD; LaunchLab's 85 SOL raise).
const fs = require("fs");
const path = require("path");
const { sized, stockLogo, guilloche, render } = require("./lib.cjs");

const DIR = process.argv[2];
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const stocks = (n, size) =>
  ["NVDAx", "SPYx", "TSLAx", "AAPLx", "QQQx", "MSTRx"]
    .slice(0, n)
    .map((s, i) => `<img src="${stockLogo(DIR, s)}" style="width:${size}px;height:${size}px;border-radius:50%;box-shadow:0 0 0 2px #0B120E;margin-left:${i ? -size * 0.28 : 0}px">`)
    .join("");

const STEPS = [
  { t: "Launch", d: "Pick a name, a ticker and the stock your holders earn. Your wallet signs the create, sent in a private bundle.", tag: "No snipers · no dev buy" },
  { t: "Trade", d: "Anyone buys and sells with SOL on the bonding curve. Every trade pays a 1% fee.", tag: "1% per trade" },
  { t: "Buy the stock", d: "Every hour, the holders' half of the fees buys the stock token the creator picked.", tag: "stocks" },
  { t: "Paid every hour", d: "The stock goes to every wallet holding $10 or more of the coin, in proportion to what it holds.", tag: "On chain receipts" },
];
const step = (s, i) => `<div class="step">
  <div class="top"><span class="n">${i + 1}</span><b>${s.t}</b></div>
  <p>${s.d}</p>
  <div class="tag">${s.tag === "stocks" ? `<span class="row">${stocks(5, 26)}</span>NVDAx, SPYx, TSLAx…` : `<i></i>${s.tag}`}</div>
</div>`;

// Where 1% of every trade on the curve goes (FEE_*_BPS).
const SPLIT = [
  ["Holders, in stock", 0.5, "#4ADE80"],
  ["Raydium", 0.25, "#3A4A42"],
  ["Creator", 0.15, "#5EEAD4"],
  ["uspad", 0.1, "#D9F99D"],
];
// The legend sits under its segments when there's room (16:9), spread evenly otherwise (4:5).
const split = (w, aligned = true) => `<div class="split">
  <div class="split-h"><b>Every trade: 1%</b><span>Buys and sells on the bonding curve, split four ways.</span></div>
  <div class="bar" style="width:${w}px">${SPLIT.map(([, p, c]) => `<i style="flex:${p};background:${c}"></i>`).join("")}</div>
  <div class="legend" style="width:${w}px;justify-content:${aligned ? "flex-start" : "space-between"}">${SPLIT.map(([l, p, c]) => `<span style="flex:${aligned ? p : "none"}"><em style="background:${c}"></em><b>${p.toFixed(2)}%</b>${l}</span>`).join("")}</div>
</div>`;

const css = `
.step{position:relative;display:flex;flex-direction:column;gap:12px;padding:24px 24px 22px;border-radius:24px;border:1px solid rgba(134,239,172,.16);background:linear-gradient(180deg,rgba(18,29,23,.94),rgba(10,16,13,.94));box-shadow:0 30px 60px -30px rgba(0,0,0,.8)}
.step .top{display:flex;align-items:center;gap:14px}
.step .n{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font:600 19px 'Inter Display',Inter;color:#06210F;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8);box-shadow:inset 0 0 0 2px rgba(255,255,255,.45),0 0 24px -4px rgba(74,222,128,.55)}
.step b{font:600 25px 'Inter Display',Inter;letter-spacing:-.02em}
.step p{margin:0;font:400 17px/1.45 Inter;color:#A3B8AD;flex:1}
.step .tag{display:flex;align-items:center;gap:9px;font:500 14.5px Inter;color:#C9E8D6}
.step .tag i{width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 10px #4ADE80}
.step .tag .row{display:flex}
.step .tag img{border-radius:50%;box-shadow:0 0 0 2px #0B120E}
.arrow{position:absolute;top:50%;width:26px;height:26px;transform:translateY(-50%);display:grid;place-items:center;color:#4ADE80;z-index:2}
.split-h{display:flex;align-items:baseline;gap:16px;margin-bottom:14px}
.split-h b{font:600 22px 'Inter Display',Inter;letter-spacing:-.01em}
.split-h span{font:400 15px Inter;color:#7E968A}
.bar{display:flex;gap:4px;height:16px}
.bar i{border-radius:6px}
.legend{display:flex;gap:4px;margin-top:12px}
.legend span{display:flex;align-items:center;gap:8px;font:400 15px Inter;color:#A3B8AD;white-space:nowrap;min-width:0}
.legend em{flex:none;width:10px;height:10px;border-radius:3px}
.legend b{font:600 15px Inter;color:#EAFBF1}
.foot{display:flex;justify-content:space-between;font:500 16px Inter;color:#6E857A}`;

const arrow = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const bg = (w, h, glows) => `background:${glows},linear-gradient(180deg,#0B130F,#070B09)`;

// 16:9: title on top, the four steps in a row joined by arrows, the fee split underneath.
const wide = `<div style="width:1600px;height:900px;position:relative;overflow:hidden;${bg(1600, 900, "radial-gradient(700px 420px at 1320px 40px,rgba(74,222,128,.16),transparent 70%),radial-gradient(800px 420px at 200px 960px,rgba(94,234,212,.08),transparent 70%)")}">
  ${guilloche(1600, 900, 40, 13, 0.05)}
  <div style="position:absolute;right:86px;top:56px;filter:drop-shadow(0 24px 44px rgba(74,222,128,.35))">${sized(read("mark.svg"), 150)}</div>
  <div style="position:absolute;left:86px;top:66px">${sized(read("lockup-dark.svg"), 150)}</div>
  <div style="position:absolute;left:86px;top:150px;width:1100px">
    <span class="pill"><i></i>How uspad works</span>
    <p style="margin:22px 0 0;font:600 64px/1.02 'Inter Display',Inter;letter-spacing:-.04em">From a launch to <span class="glow">stock dividends,</span><br>every hour.</p>
  </div>
  <div style="position:absolute;left:86px;right:86px;top:392px;display:grid;grid-template-columns:repeat(4,1fr);gap:34px">
    ${STEPS.map(step).join("")}
    ${[0, 1, 2].map((i) => `<div class="arrow" style="left:calc(${(i + 1) * 25}% - ${30 - i * 8.5}px)">${arrow}</div>`).join("")}
  </div>
  <div style="position:absolute;left:86px;top:690px">${split(1428)}</div>
  <div class="foot" style="position:absolute;left:86px;right:86px;bottom:36px"><span>uspad.fun · @uspadfun · t.me/uspadfun</span><span>At 85 SOL a coin graduates to Raydium, its liquidity locked for good</span></div>
</div>`;

// 4:5: the same story stacked, for phones.
const tall = `<div style="width:1080px;height:1350px;position:relative;overflow:hidden;${bg(1080, 1350, "radial-gradient(620px 420px at 900px 60px,rgba(74,222,128,.16),transparent 70%),radial-gradient(700px 500px at 120px 1400px,rgba(94,234,212,.08),transparent 70%)")}">
  ${guilloche(1080, 1350, 54, 12, 0.05)}
  <div style="position:absolute;right:72px;top:58px;filter:drop-shadow(0 24px 44px rgba(74,222,128,.35))">${sized(read("mark.svg"), 128)}</div>
  <div style="position:absolute;left:72px;top:70px">${sized(read("lockup-dark.svg"), 140)}</div>
  <div style="position:absolute;left:72px;top:168px;width:900px">
    <span class="pill"><i></i>How uspad works</span>
    <p style="margin:20px 0 0;font:600 58px/1.04 'Inter Display',Inter;letter-spacing:-.04em">From a launch to <span class="glow">stock dividends,</span> every hour.</p>
  </div>
  <div style="position:absolute;left:72px;right:72px;top:398px;display:grid;grid-template-columns:1fr 1fr;gap:22px">${STEPS.map(step).join("")}</div>
  <div style="position:absolute;left:72px;top:868px">${split(936, false)}</div>
  <div style="position:absolute;left:72px;right:72px;top:1012px;font:400 17px/1.45 Inter;color:#A3B8AD">At 85 SOL a coin graduates to Raydium with its liquidity locked for good, and the dividends keep coming.</div>
  <div style="position:absolute;left:72px;right:72px;top:1104px;display:flex;align-items:center;justify-content:space-between;padding:26px 30px;border-radius:24px;border:1px solid rgba(134,239,172,.22);background:linear-gradient(100deg,rgba(74,222,128,.12),rgba(94,234,212,.06))">
    <span style="font:600 34px 'Inter Display',Inter;letter-spacing:-.03em">Launch yours at <span class="glow">uspad.fun</span></span>
    <span style="display:flex">${stocks(6, 44)}</span>
  </div>
  <div class="foot" style="position:absolute;left:72px;right:72px;bottom:44px"><span>uspad.fun · @uspadfun</span><span>t.me/uspadfun</span></div>
</div>`;

(async () => {
  await render(DIR, "how-it-works-3200x1800.png", 1600, 900, css, wide);
  await render(DIR, "how-it-works-2160x2700.png", 1080, 1350, css, tall);
  console.log("done");
})();
