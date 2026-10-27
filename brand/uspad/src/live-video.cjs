// "uspad is live" video for X (16:9, 1920 x 1080, 30 fps, H.264): the launchpad open to the public,
// walked through on the real interface. The product shots are the site in demo mode, with sample data,
// and the video says so. Every uspad fact matches the How it works page.
// Usage (repo root), after live-shots.cjs:
//   node brand/uspad/src/live-video.cjs brand/uspad [--stills <dir>]
//   python3 brand/uspad/src/live-music.py brand/uspad          # the soundtrack
const fs = require("fs");
const path = require("path");
const { sized, stockLogo, guilloche, renderVideo } = require("./lib.cjs");

const DIR = process.argv[2];
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const shot = (name) => `data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, "social", "live-shots", `${name}.jpg`)).toString("base64")}`;
const W = 1920;
const H = 1080;

// Scenes, [start, length] in seconds, on 2-second bars of live-music.py (120 BPM).
const S = { live: [0, 6], launch: [6, 6], golive: [12, 4], chart: [16, 8], paid: [24, 6], split: [30, 4], open: [34, 8] };
const DURATION = S.open[0] + S.open[1];
const scene = (k, inner, cls = "") => `<section class="scene ${cls}" style="--s:${S[k][0]}s;--d:${S[k][1]}s">${inner}</section>`;
const at = (o) => `--o:${o}s`;

const STOCKS = ["NVDAx", "SPYx", "TSLAx", "AAPLx", "QQQx", "MSTRx"];
const check = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06210F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
const lock = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/** A browser window around a product shot. `cam` names the keyframes that move the shot inside it. */
const browser = ({ x, y, w, url, img, cam, o = 0.2 }) => {
  const h = Math.round((w * 1800) / 2880);
  return `<div class="bw in" style="left:${x}px;top:${y}px;width:${w}px;${at(o)}">
    <div class="bar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i><span class="url">${lock}${url}</span></div>
    <div class="vp" style="height:${h}px"><img src="${img}" style="width:${w}px;height:${h}px;animation:${cam} var(--d) cubic-bezier(.45,0,.25,1) var(--s) both"></div>
    <span class="sample">Interface preview, sample data</span>
  </div>`;
};
const points = (items, o) =>
  `<div class="points">${items.map((t, i) => `<div class="pt in" style="${at(o + i * 0.25)}"><span class="ck">${check}</span>${t}</div>`).join("")}</div>`;
const tags = (items, o) => `<div class="tags">${items.map((t, i) => `<span class="tag in" style="${at(o + i * 0.18)}">${t}</span>`).join("")}</div>`;

// Specks of light drifting up through the whole video.
const dust = Array.from({ length: 46 }, (_, i) => {
  const x = (i * 397) % W;
  const y = (i * 211) % H;
  const s = 2 + (i % 3);
  return `<i class="dust" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;opacity:${0.12 + (i % 5) * 0.05};animation-duration:${DURATION}s;--dy:${-160 - (i % 7) * 40}px"></i>`;
}).join("");

// The 1.25% split, out of 1400 px (same as the intro and the How it works page).
let x = 0;
const split = [
  ["0.50%", "holders", 560, "linear-gradient(100deg,#86EFAC,#4ADE80)"],
  ["0.15%", "creator", 168, "#2E7D52"],
  ["0.35%", "uspad", 392, "#D9F99D"],
  ["0.25%", "Raydium", 280, "#1B2621"],
];
const segs = split.map(([, , w, bg], i) => `<div class="seg" style="left:${(x += w) - w}px;width:${w}px;background:${bg};${at(0.6 + i * 0.3)}"></div>`).join("");
x = 0;
const segLabels = split
  .map(([pct, who, w], i) => `<div class="segl in" style="left:${(x += w) - w}px;${at(0.85 + i * 0.3)}"><b style="color:${i ? "#EAFBF1" : "#4ADE80"}">${pct}</b><span>${who}</span></div>`)
  .join("");

// Product shots are 1440 x 900 pages at 2x. Camera keyframes move them inside the window.
const css = `
.stage{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:radial-gradient(1200px 700px at 50% 120%,rgba(74,222,128,.10),transparent 70%),linear-gradient(180deg,#0B130F,#070B09)}
.glowbg{position:absolute;width:1500px;height:1100px;left:210px;top:-40px;background:radial-gradient(closest-side,rgba(74,222,128,.20),transparent);animation:drift ${DURATION}s linear 0s both}
@keyframes drift{0%{transform:translate(-300px,-60px)}50%{transform:translate(200px,60px)}100%{transform:translate(-100px,0)}}
.dust{position:absolute;border-radius:50%;background:#B6FFD2;box-shadow:0 0 8px #4ADE80;animation:float linear 0s both}
@keyframes float{to{transform:translateY(var(--dy))}}
.vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.55));pointer-events:none}
.center{position:absolute;left:0;right:0;text-align:center}
.h1{font:700 128px/1 'Inter Display',Inter;letter-spacing:-.05em;margin:0}
.h2{font:600 64px/1.04 'Inter Display',Inter;letter-spacing:-.04em;margin:0}
.lede{font:400 30px/1.45 Inter;color:#A9BDB3;margin:0}
.kicker{font:600 20px Inter;color:#4ADE80;letter-spacing:.02em;margin:0 0 18px}
.pill{font-size:24px;padding:10px 22px;gap:12px}
.pill i{width:11px;height:11px;animation:pulse 1.2s ease-in-out 0s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.7)}50%{box-shadow:0 0 0 10px rgba(74,222,128,0)}}
.shine{background:linear-gradient(100deg,#EAFBF1 0%,#EAFBF1 40%,#FFFFFF 50%,#EAFBF1 60%,#EAFBF1 100%);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 2.4s ease-in-out calc(var(--s) + 1.4s) both}
@keyframes shine{from{background-position:100% 0}to{background-position:0 0}}
.mark{position:absolute;left:960px;top:330px;transform:translate(-50%,-50%);filter:drop-shadow(0 30px 70px rgba(74,222,128,.5)) drop-shadow(0 0 30px rgba(74,222,128,.25))}
.mark .spin{animation:flip 1.4s cubic-bezier(.2,.8,.2,1) calc(var(--s) + .2s) both}
@keyframes flip{from{transform:perspective(900px) rotateY(-110deg) scale(.55);opacity:0}to{transform:perspective(900px) rotateY(0) scale(1);opacity:1}}
.burst{position:absolute;left:960px;top:330px;width:620px;height:620px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid rgba(134,239,172,.5);animation:burst 1.6s ease-out calc(var(--s) + .4s) both}
@keyframes burst{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}
.stocks{position:absolute;left:0;right:0;top:900px;display:flex;justify-content:center;gap:26px}
.stk{display:flex;align-items:center;gap:12px;padding:10px 18px 10px 10px;border-radius:999px;background:rgba(17,27,22,.85);border:1px solid rgba(134,239,172,.16);font:600 22px Inter;color:#C9E8D6}
.stk img{width:44px;height:44px;border-radius:50%}
.bw{position:absolute;border-radius:22px;overflow:hidden;background:#0B110E;border:1px solid rgba(134,239,172,.2);box-shadow:0 60px 120px -40px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.03),0 0 80px -30px rgba(74,222,128,.35)}
.bw .bar{height:46px;display:flex;align-items:center;gap:9px;padding:0 18px;background:#101814;border-bottom:1px solid rgba(255,255,255,.05)}
.bw .bar i{width:13px;height:13px;border-radius:50%}
.bw .url{margin:0 auto;display:flex;align-items:center;gap:8px;font:500 17px Inter;color:#97ACA2;background:rgba(255,255,255,.04);border-radius:10px;padding:6px 18px;transform:translateX(-28px)}
.bw .vp{position:relative;overflow:hidden}
.bw img{display:block;transform-origin:0 0}
.bw .sample{position:absolute;right:14px;bottom:12px;font:500 14px Inter;color:#C9E8D6;background:rgba(7,11,9,.78);border:1px solid rgba(134,239,172,.18);padding:5px 12px;border-radius:999px}
.points{display:flex;flex-direction:column;gap:22px;margin-top:34px}
.pt{display:flex;align-items:center;gap:16px;font:500 28px Inter;color:#EAFBF1}
.ck{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8)}
.tags{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:22px}
.tag{font:500 22px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.22);background:rgba(74,222,128,.07);padding:9px 18px;border-radius:999px}
.cap{position:absolute;left:0;right:0;text-align:center}
.cap.a{animation:capA var(--d) linear var(--s) both}.cap.b{animation:capB var(--d) linear var(--s) both}
@keyframes capA{0%,6%{opacity:0;transform:translateY(20px)}12%,50%{opacity:1;transform:none}56%,100%{opacity:0;transform:translateY(-14px)}}
@keyframes capB{0%,54%{opacity:0;transform:translateY(20px)}62%,100%{opacity:1;transform:none}}
@keyframes camCreate{from{transform:translate(0,0) scale(1)}to{transform:translate(-90px,-70px) scale(1.12)}}
@keyframes camLaunched{0%,15%{transform:translate(0,0) scale(1)}70%,100%{transform:translate(-434px,-271px) scale(1.7)}}
@keyframes camCoin{0%,30%{transform:translate(0,0) scale(1)}45%,58%{transform:translate(-53px,-125px) scale(1.5)}72%,100%{transform:translate(-780px,-143px) scale(1.6)}}
@keyframes camPayouts{from{transform:translate(0,0) scale(1)}to{transform:translate(-60px,-110px) scale(1.18)}}
.coinpop{position:absolute;transform:translate(-50%,-50%)}
.coinpop img{width:84px;height:84px;border-radius:50%;box-shadow:0 0 0 3px rgba(255,255,255,.2),0 20px 40px -10px rgba(0,0,0,.8),0 0 40px -6px rgba(74,222,128,.6)}
.bar1{position:absolute;left:260px;top:470px;width:1400px;height:96px;border-radius:22px;overflow:hidden;box-shadow:0 0 0 1px rgba(134,239,172,.16)}
.seg{position:absolute;top:0;height:96px;transform-origin:left center;animation:seg .55s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
@keyframes seg{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.labels{position:absolute;left:260px;top:590px;width:1400px}
.segl{position:absolute;top:0;display:flex;flex-direction:column;gap:4px;padding-left:4px}
.segl b{font:700 36px 'Inter Display',Inter;letter-spacing:-.02em}.segl span{font:500 24px Inter;color:#97ACA2}
.fine{position:absolute;left:0;right:0;bottom:40px;text-align:center;font:400 18px Inter;color:#5F766B}
.cta{display:inline-flex;align-items:center;gap:14px;font:700 34px 'Inter Display',Inter;color:#06210F;background:linear-gradient(100deg,#C9FFE0,#4ADE80 45%,#D9F99D);padding:20px 40px;border-radius:999px;box-shadow:0 20px 60px -20px rgba(74,222,128,.8)}
`;

const html = `<div class="stage">
  <div class="glowbg"></div>
  ${guilloche(W, H, 44, 15, 0.045)}
  ${dust}

  ${scene(
    "live",
    `<div class="burst"></div>
     <div class="mark"><div class="spin">${sized(read("mark.svg"), 300)}</div></div>
     <div class="center in" style="top:520px;${at(1.0)}"><span class="pill"><i></i>Live on Solana mainnet</span></div>
     <p class="center h1 in" style="top:600px;${at(1.3)}"><span class="shine">uspad is </span><span class="glow">live.</span></p>
     <p class="center lede in" style="top:755px;${at(1.9)}">Memecoins that pay you in US stocks, every hour.</p>
     <div class="stocks">${STOCKS.map((s, i) => `<span class="stk in" style="${at(2.5 + i * 0.12)}"><img src="${stockLogo(DIR, s)}">${s}</span>`).join("")}</div>`,
  )}

  ${scene(
    "launch",
    `<div style="position:absolute;left:110px;top:250px;width:640px">
       <p class="kicker in" style="${at(0.1)}">Launch</p>
       <p class="h2 in" style="${at(0.2)}">Launch a coin<br>in seconds.</p>
       ${points(["Pick the stock your holders earn", "Copycats and lookalikes refused", "A private bundle: no snipers", "No dev buy, no team tokens"], 0.7)}
     </div>
     ${browser({ x: 800, y: 175, w: 1040, url: "uspad.fun/create", img: shot("create"), cam: "camCreate" })}`,
  )}

  ${scene(
    "golive",
    `<p class="center h2 in" style="top:60px;${at(0.1)}">Live in one private bundle.</p>
     ${browser({ x: 340, y: 175, w: 1240, url: "uspad.fun/create", img: shot("launched"), cam: "camLaunched", o: 0.05 })}`,
  )}

  ${scene(
    "chart",
    `<div class="cap a" style="top:40px"><p class="h2">A live candlestick chart.</p>${tags(["1m to 1D candles", "Price or market cap", "A dot for every payout"], 0.5)}</div>
     <div class="cap b" style="top:40px"><p class="h2">Buy and sell right on uspad.</p><div class="tags"><span class="tag">1.25% fee, 0.50% to holders</span><span class="tag">Balances update live</span></div></div>
     ${browser({ x: 310, y: 205, w: 1300, url: "uspad.fun/coin/CHIPDOG", img: shot("coin"), cam: "camCoin", o: 0.1 })}`,
  )}

  ${scene(
    "paid",
    `<div style="position:absolute;left:110px;top:270px;width:640px">
       <p class="kicker in" style="${at(0.1)}">Dividends</p>
       <p class="h2 in" style="${at(0.2)}">Paid every hour, in real stock tokens.</p>
       <p class="lede in" style="margin-top:26px;${at(0.6)}">Hold $10 or more of a coin and its stock lands in your wallet. Every round is a public receipt.</p>
     </div>
     ${browser({ x: 800, y: 175, w: 1040, url: "uspad.fun/payouts", img: shot("payouts"), cam: "camPayouts" })}
     ${STOCKS.map((s, i) => `<div class="coinpop pop" style="left:${158 + i * 104}px;top:${790 - (i % 2) * 22}px;${at(0.9 + i * 0.25)}"><img src="${stockLogo(DIR, s)}"></div>`).join("")}`,
  )}

  ${scene(
    "split",
    `<p class="center h2 in" style="top:200px;${at(0.1)}">Every trade pays 1.25%. 0.50% goes to holders.</p>
     <div class="bar1">${segs}</div>
     <div class="labels">${segLabels}</div>
     <p class="center lede in" style="top:800px;${at(1.8)}">Graduates to Raydium at 85 SOL. Its liquidity is locked forever.</p>`,
  )}

  ${scene(
    "open",
    `<div class="burst" style="top:250px"></div>
     <div class="pop" style="position:absolute;left:960px;top:250px;${at(0.15)}">${sized(read("lockup-dark.svg"), 520)}</div>
     <p class="center h1 in" style="top:400px;font-size:104px;${at(0.5)}"><span class="shine">Launchpad open </span><span class="glow">to the public.</span></p>
     <div class="center in" style="top:600px;${at(1.1)}"><span class="cta">Launch your coin at uspad.fun</span></div>
     <p class="center lede in" style="top:735px;${at(1.5)}">Follow @uspadfun</p>
     <p class="fine in" style="${at(2.0)}">Interface shown with sample data. Tokenized stocks are issued by third parties and aren't available to US persons. Nothing here is financial advice.</p>`,
    "last",
  )}
  <div class="vignette"></div>
</div>`;

const stillsAt = process.argv.indexOf("--stills");
renderVideo({
  out: path.join(DIR, "social", "uspad-live-1920x1080.mp4"),
  width: W,
  height: H,
  fps: 30,
  duration: DURATION,
  css,
  html,
  stills: stillsAt > 0 ? { dir: process.argv[stillsAt + 1], times: [3.5, 9.5, 15.2, 17.5, 21, 23.5, 28.5, 33, 38] } : undefined,
}).then(
  () => console.log(stillsAt > 0 ? "stills done" : "video done"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
