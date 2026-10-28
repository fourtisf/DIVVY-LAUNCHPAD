// "$USPAD is live" video for X (16:9, 1920 x 1080, 30 fps with motion blur, H.264), shot like a product
// film: letterboxed, a macro pass along the $USPAD coin's rim in the dark, the coin turning to face the
// camera under a sweeping light (token3d.ts), then a flight through the live site with its pages cut
// into panels floating in depth, the stock coins orbiting, the fee as a ring, and a closing push in.
// It names the ticker only: no contract address anywhere (owner request 2026-10-28), and the closing line
// sends people to @uspadfun for it, since tickers can repeat on uspad. The panels come from the owner's
// screenshots of the live site (social/token-shots, addresses painted over), so their numbers are real at
// that moment.
// Usage (repo root):
//   node brand/uspad/src/token-video.cjs brand/uspad [--stills <dir>]
//   python3 brand/uspad/src/token-music.py brand/uspad          # the soundtrack
const fs = require("fs");
const path = require("path");
const { stockArt, bundle3d, renderVideo } = require("./lib.cjs");

const DIR = process.argv[2];
const W = 1920;
const H = 1080;
const FPS = 30;

// Scenes, [start, length] in seconds, on the 2-second bars of token-music.py (120 BPM).
const S = { macro: [0, 6], reveal: [6, 6], board: [12, 4], chart: [16, 4], holders: [20, 4], receipts: [24, 4], orbit: [28, 6], split: [34, 4], end: [38, 6] };
const DURATION = S.end[0] + S.end[1];
const TOUR = [S.board[0], S.receipts[0] + S.receipts[1]];
const scene = (k, inner, cls = "") => `<section class="scn ${cls}" style="--s:${S[k][0]}s;--d:${S[k][1]}s">${inner}</section>`;
const at = (o) => `--o:${o}s`;
const extraCss = [];
const pct = (t, [s, d]) => `${(((t - s) / d) * 100).toFixed(3)}%`;
/** Keyframes over an absolute span [start, length] from [second, css] pairs, held before and after. */
const keyed = (name, spanSec, stops) => {
  const all = [[spanSec[0], stops[0][1]], ...stops, [spanSec[0] + spanSec[1], stops[stops.length - 1][1]]];
  extraCss.push(`@keyframes ${name}{${all.map(([t, v]) => `${pct(t, spanSec)}{${v}}`).join("")}}`);
  return `animation:${name} ${spanSec[1]}s cubic-bezier(.45,0,.2,1) ${spanSec[0]}s both`;
};

const STOCKS = stockArt(DIR);

/* ---------- type ---------- */

/** Text that decodes: each letter rolls through glyphs and lands on itself, left to right. */
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789$#%&";
let decodes = 0;
const decode = (text, o, step = 0.07) =>
  [...text]
    .map((ch, i) => {
      const seq = [...Array.from({ length: 8 }, (_, j) => GLYPHS[(i * 7 + j * 11 + decodes) % GLYPHS.length]), ch];
      const name = `dec${decodes++}`;
      extraCss.push(`@keyframes ${name}{from{transform:translateY(0)}to{transform:translateY(-${seq.length - 1}em)}}`);
      return `<span class="dec" style="${at(o + i * step)}"><span class="sz">${ch}</span><span class="col" style="animation:${name} ${0.55 + i * 0.05}s steps(${seq.length - 1}) calc(var(--s) + ${o + i * step}s) both">${seq.map((c) => `<i>${c}</i>`).join("")}</span></span>`;
    })
    .join("");

/** Words that rise out of a mask, one after another. */
const words = (text, o, step = 0.09, cls = "") =>
  text
    .split(" ")
    .map((w, i) => `<span class="wm"><span class="wi ${cls}" style="${at(o + step * i)}">${w}</span></span>`)
    .join(" ");

/* ---------- the live site, cut into panels ---------- */

const SHOT = { board: [1895, 866], grid: [1888, 862], coin: [1888, 869], holders: [1861, 872], payouts: [1871, 857] };
const shotCss = Object.keys(SHOT)
  .map((k) => `.sh-${k}{background-image:url(data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, "social", "token-shots", `${k}.jpg`)).toString("base64")})}`)
  .join("\n");

/**
 * A region [x, y, w, h] of a live shot as a glass panel at world position [x, y, z], `k` px per shot px.
 * It rises out of depth at second `t`; `reveal` wipes its content in ("down" for tables, "right" for
 * the chart).
 */
const panel = (shot, [sx, sy, sw, sh], { pos: [x, y, z], k = 1, ry = 0, rx = 0, t, reveal }) => {
  const w = Math.round(sw * k);
  const h = Math.round(sh * k);
  const wipe = reveal === "down" ? "wipeDown" : reveal === "right" ? "wipeRight" : "";
  return `<div class="pos" style="transform:translate3d(${x}px,${y}px,${z}px) rotateY(${ry}deg) rotateX(${rx}deg)">
    <div class="ent" style="animation-delay:${t}s"><div class="pan sh-${shot}" style="width:${w}px;height:${h}px;background-size:${(SHOT[shot][0] * k).toFixed(1)}px ${(SHOT[shot][1] * k).toFixed(1)}px;background-position:${(-sx * k).toFixed(1)}px ${(-sy * k).toFixed(1)}px;${wipe ? `animation:${wipe} 1.3s cubic-bezier(.45,0,.2,1) ${t + 0.35}s both` : ""}"></div></div>
  </div>`;
};

// Stations along the flight, 2300 px apart; the camera holds on each, drifting, then whips to the next.
const X = { board: 0, chart: 2300, holders: 4600, receipts: 6900 };
const st = (k, d = 0) => S[k][0] + d;
const world = [
  // The board: its headline and live payouts pill, two coin cards and the activity strip.
  panel("board", [40, 372, 880, 420], { pos: [X.board - 900, -400, 0], k: 0.92, ry: 10, t: st("board", -0.2) }),
  panel("board", [42, 230, 430, 50], { pos: [X.board - 860, -500, 160], k: 1.15, ry: 10, t: st("board", 0.2) }),
  panel("grid", [502, 183, 437, 420], { pos: [X.board + 70, -380, 140], k: 0.92, ry: -14, t: st("board", 0) }),
  panel("grid", [1423, 183, 437, 420], { pos: [X.board + 520, -300, -140], k: 0.92, ry: -20, t: st("board", 0.15) }),
  panel("board", [0, 108, 1895, 62], { pos: [X.board - 980, 120, -260], k: 1.05, t: st("board", 0.3) }),
  // A coin page: the stats, the candlestick chart wiping in, and the trade box in front.
  panel("coin", [42, 343, 1818, 118], { pos: [X.chart - 600, -470, -60], k: 0.62, t: st("chart", -0.1) }),
  panel("coin", [42, 488, 1214, 381], { pos: [X.chart - 820, -360, 0], k: 0.92, ry: 8, t: st("chart", 0), reveal: "right" }),
  panel("coin", [1284, 488, 576, 381], { pos: [X.chart + 340, -320, 180], k: 0.9, ry: -12, t: st("chart", 0.2) }),
  // Holders: the table rolling down, what was paid out, and where the fee goes.
  panel("holders", [24, 100, 1214, 742], { pos: [X.holders - 820, -400, 0], k: 0.64, ry: 10, t: st("holders", -0.1), reveal: "down" }),
  panel("holders", [1266, 100, 574, 510], { pos: [X.holders + 40, -370, 170], k: 0.74, ry: -10, t: st("holders", 0.15) }),
  panel("holders", [1266, 632, 574, 240], { pos: [X.holders + 180, 40, 70], k: 0.78, ry: -14, t: st("holders", 0.3) }),
  // Payouts: the receipts rolling down, and one row lifting out toward the camera.
  panel("payouts", [42, 155, 1818, 565], { pos: [X.receipts - 640, -420, 0], k: 0.68, rx: 6, t: st("receipts", -0.1), reveal: "down" }),
  panel("payouts", [72, 325, 1756, 72], { pos: [X.receipts - 760, -90, 240], k: 0.86, rx: 4, t: st("receipts", 1.0) }),
].join("");

/** The camera: [second, x, y, depth] stops; holds drift slowly, cuts between stations whip. */
const cam = (stops) => keyed("cam", [TOUR[0], TOUR[1] - TOUR[0]], stops.map(([t, x, y, z]) => [t, `transform:translate3d(${-x}px,${-y}px,${z}px)`]));
const camera = cam([
  [12, -260, -60, -420],
  [15.4, 180, 0, 0],
  [15.95, X.chart - 260, -60, -160],
  [19.4, X.chart + 180, 0, 60],
  [19.95, X.holders - 260, -60, -160],
  [23.4, X.holders + 180, 0, 60],
  [23.95, X.receipts - 260, -60, -160],
  [28, X.receipts + 200, 0, 140],
]);

/** A station's caption, bottom left: its number, a title and a line of text. */
const caption = (k, n, label, title, body) =>
  scene(
    k,
    `<div class="cap">
      <div class="kick in" style="${at(0.15)}"><b>${n}</b><span>/ 04</span>${label}</div>
      <p class="ct">${words(title, 0.3)}</p>
      <p class="cb in" style="${at(0.75)}">${body}</p>
    </div>`,
  );

/* ---------- the fee ring ---------- */

const R = 196;
const C = 2 * Math.PI * R;
const SPLIT = [
  ["Holders, paid in stock", 0.5, "#4ADE80"],
  ["uspad", 0.35, "#D9F99D"],
  ["Raydium", 0.25, "#4B5D54"],
  ["Creator", 0.15, "#5EEAD4"],
];
let from = 0;
const ring = SPLIT.map(([, v, c], i) => {
  const len = (v / 1.25) * C - 6;
  const arc = `<circle cx="260" cy="260" r="${R}" fill="none" stroke="${c}" stroke-width="40" stroke-linecap="butt" stroke-dasharray="0 ${C}" stroke-dashoffset="${-from}" transform="rotate(-90 260 260)" style="animation:arc${i} 1s cubic-bezier(.45,0,.2,1) calc(var(--s) + ${0.35 + i * 0.28}s) both"/>`;
  extraCss.push(`@keyframes arc${i}{from{stroke-dasharray:0 ${C}}to{stroke-dasharray:${len.toFixed(1)} ${C}}}`);
  from += (v / 1.25) * C;
  return arc;
}).join("");

/* ---------- the stage ---------- */

const grain = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}`;
const arrow = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const BAR = 96;

const css = `
${shotCss}
.stage{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#020403}
.fog{position:absolute;border-radius:50%;filter:blur(110px);mix-blend-mode:screen;animation:var(--k) ${DURATION}s ease-in-out 0s both}
@keyframes fogA{0%{transform:translate(300px,200px) scale(.8);opacity:.0}12%{opacity:.9}50%{transform:translate(1000px,420px) scale(1.2)}100%{transform:translate(500px,260px) scale(1)}}
@keyframes fogB{0%{transform:translate(1300px,600px);opacity:0}14%{opacity:.7}60%{transform:translate(200px,380px)}100%{transform:translate(1100px,120px)}}
.rays{position:absolute;left:960px;top:-260px;width:2600px;height:1700px;margin-left:-1300px;background:repeating-conic-gradient(from 180deg at 50% 0,rgba(182,255,210,.055) 0deg 2.2deg,transparent 2.2deg 7deg);-webkit-mask-image:radial-gradient(ellipse 45% 65% at 50% 0,#000 0%,transparent 75%);mask-image:radial-gradient(ellipse 45% 65% at 50% 0,#000 0%,transparent 75%);mix-blend-mode:screen}
.c3d{position:absolute;inset:0}
.c3d canvas{position:absolute;inset:0;display:block;width:${W}px;height:${H}px}
.c3d canvas.glow{filter:blur(24px) brightness(.95) saturate(1.6);mix-blend-mode:screen}
.flare{position:absolute;left:0;width:${W}px;height:3px;background:linear-gradient(90deg,transparent,rgba(126,242,216,.0) 15%,rgba(206,255,232,.9) 50%,rgba(126,242,216,0) 85%,transparent);box-shadow:0 0 30px 6px rgba(94,234,212,.35);filter:blur(1px);mix-blend-mode:screen}
.flare i{position:absolute;top:-70px;width:220px;height:140px;margin-left:-110px;border-radius:50%;background:radial-gradient(closest-side,rgba(240,255,248,.95),rgba(126,242,216,.35) 40%,transparent 70%)}
.scn{position:absolute;inset:0;opacity:0;animation:scn var(--d) linear var(--s) both}
.scn.last{animation-name:scnLast}
@keyframes scn{0%{opacity:0}7%{opacity:1}93%{opacity:1}100%{opacity:0}}
@keyframes scnLast{0%{opacity:0}8%{opacity:1}100%{opacity:1}}
.in{animation:rise .9s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o,0s)) both}
@keyframes rise{from{opacity:0;transform:translateY(22px);filter:blur(8px)}to{opacity:1;transform:none;filter:none}}
.wm{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .02em .12em;margin-bottom:-.12em}
.wi{display:inline-block;animation:wordIn 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
@keyframes wordIn{from{transform:translateY(110%);filter:blur(10px);opacity:0}to{transform:none;filter:none;opacity:1}}
.center{position:absolute;left:0;right:0;text-align:center}
.dec{position:relative;display:inline-block;height:1em;overflow:hidden;vertical-align:top;animation:decIn .2s linear calc(var(--s) + var(--o)) both}
.dec .sz{visibility:hidden}
@keyframes decIn{from{opacity:0}to{opacity:1}}
.dec .col{position:absolute;left:0;right:0;top:0;display:flex;flex-direction:column;align-items:center}
.dec i{font-style:normal;height:1em;line-height:1em;background:linear-gradient(180deg,#F4FFF9 0%,#B8F7CF 55%,#3FCB7A 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.title{font:700 176px/1 'Inter Display',Inter;letter-spacing:-.045em;margin:0;filter:drop-shadow(0 0 40px rgba(74,222,128,.35))}
.thin{font:200 176px/1 'Inter Display',Inter;letter-spacing:-.04em;color:#E6FBEF}
.lede{font:300 30px/1.45 Inter;color:#A9BDB3;margin:0;letter-spacing:.01em}
.whisper{font:300 34px/1.5 Inter;color:#C9E8D6;letter-spacing:.34em;margin:0}
.whisper .rule{display:block;width:64px;height:2px;margin-bottom:26px;background:#4ADE80;box-shadow:0 0 14px #4ADE80}
.pill{display:inline-flex;align-items:center;gap:12px;font:500 22px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.24);background:rgba(74,222,128,.07);padding:9px 20px;border-radius:999px}
.pill i{width:10px;height:10px;border-radius:50%;background:#4ADE80;box-shadow:0 0 12px #4ADE80}
.space{position:absolute;inset:0;perspective:1500px;perspective-origin:50% 42%;opacity:0;${keyed("space", [TOUR[0] - 0.2, TOUR[1] - TOUR[0] + 0.4], [[TOUR[0] - 0.2, "opacity:0"], [TOUR[0] + 0.3, "opacity:1"], [TOUR[1] - 0.35, "opacity:1"], [TOUR[1] + 0.2, "opacity:0"]])}}
.world{position:absolute;left:${W / 2}px;top:${H / 2}px;transform-style:preserve-3d;${camera}}
.pos{position:absolute;left:0;top:0;transform-style:preserve-3d}
.ent{transform-style:preserve-3d;animation:ent 1.1s cubic-bezier(.16,1,.3,1) both}
@keyframes ent{from{opacity:0;transform:translateZ(-320px) translateY(60px)}to{opacity:1;transform:none}}
.pan{border-radius:18px;background-repeat:no-repeat;box-shadow:0 0 0 1px rgba(134,239,172,.22),0 50px 120px -30px rgba(0,0,0,.95),0 0 120px -40px rgba(74,222,128,.55);position:relative;overflow:hidden}
.pan::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 30%,rgba(255,255,255,.09) 45%,transparent 60%);pointer-events:none}
@keyframes wipeDown{from{clip-path:inset(0 0 100% 0 round 18px)}to{clip-path:inset(0 0 0 0 round 18px)}}
@keyframes wipeRight{from{clip-path:inset(0 100% 0 0 round 18px)}to{clip-path:inset(0 0 0 0 round 18px)}}
.shade{position:absolute;left:0;bottom:0;width:1200px;height:520px;background:radial-gradient(ellipse 70% 80% at 10% 100%,rgba(2,4,3,.92),transparent 70%)}
.cap{position:absolute;left:110px;bottom:118px;width:900px}
.kick{display:flex;align-items:baseline;gap:12px;font:500 22px Inter;color:#9FB7AB;letter-spacing:.04em;margin-bottom:18px}
.kick b{font:600 22px 'Inter Display',Inter;color:#4ADE80}
.kick span{color:#5F766B;margin-right:10px}
.ct{font:600 92px/1 'Inter Display',Inter;letter-spacing:-.04em;margin:0;color:#F2FFF7}
.cb{font:300 28px/1.45 Inter;color:#A9BDB3;margin:20px 0 0;max-width:760px}
.low{position:absolute;left:0;right:0;bottom:0;height:420px;background:linear-gradient(180deg,transparent,rgba(2,4,3,.88) 55%)}
.h3{font:600 74px/1.05 'Inter Display',Inter;letter-spacing:-.04em;margin:0;color:#F2FFF7}
.glowt{background:linear-gradient(100deg,#C9FFE0,#4ADE80 45%,#D9F99D);-webkit-background-clip:text;background-clip:text;color:transparent}
.syms{font:500 24px Inter;color:#9FB7AB;letter-spacing:.06em}
.syms b{color:#C9E8D6;font-weight:600;margin:0 10px}
.ringw{position:absolute;left:330px;top:250px;width:520px;height:520px}
.ringw svg{position:absolute;inset:0;filter:drop-shadow(0 0 30px rgba(74,222,128,.3))}
.ringc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ringc b{font:700 104px/1 'Inter Display',Inter;letter-spacing:-.05em;background:linear-gradient(180deg,#F4FFF9,#3FCB7A);-webkit-background-clip:text;background-clip:text;color:transparent}
.ringc span{font:300 24px Inter;color:#9FB7AB;margin-top:10px;letter-spacing:.04em}
.legend{position:absolute;left:980px;top:330px;width:700px}
.legend h4{font:600 60px/1.05 'Inter Display',Inter;letter-spacing:-.035em;margin:0 0 34px;color:#F2FFF7}
.row{display:flex;align-items:center;gap:18px;font:400 30px Inter;color:#C9E8D6;padding:16px 0;border-top:1px solid rgba(134,239,172,.12)}
.row em{width:16px;height:16px;border-radius:5px}
.row b{margin-left:auto;font:600 32px 'Inter Display',Inter;color:#F2FFF7}
.cta{display:inline-flex;align-items:center;gap:14px;font:700 34px 'Inter Display',Inter;letter-spacing:-.02em;color:#06210F;background:linear-gradient(100deg,#C9FFE0,#4ADE80 45%,#D9F99D);padding:18px 38px;border-radius:999px;box-shadow:0 24px 70px -18px rgba(74,222,128,.85),inset 0 0 0 2px rgba(255,255,255,.4);position:relative;overflow:hidden;vertical-align:middle}
.cta::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);transform:translateX(-130%);animation:glass 1.4s cubic-bezier(.45,0,.2,1) calc(var(--s) + 2.3s) both}
@keyframes glass{to{transform:translateX(130%)}}
.socials{font:400 26px Inter;color:#9FB7AB;margin-left:26px;vertical-align:middle}
.fine{position:absolute;left:0;right:0;bottom:${BAR + 18}px;text-align:center;font:400 16px Inter;color:#5F766B}
.bar{position:absolute;left:0;right:0;height:${BAR}px;background:#000;z-index:9}
.flash{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(214,255,232,.55),rgba(74,222,128,.12) 45%,transparent 75%);mix-blend-mode:screen;opacity:0;animation:flash .5s ease-out var(--t) both;z-index:8}
@keyframes flash{0%{opacity:0}12%{opacity:1}100%{opacity:0}}
.grain{position:absolute;inset:-80px;background-image:url("${grain}");opacity:.085;mix-blend-mode:overlay;animation:grain .5s steps(5) 0s infinite;z-index:7}
@keyframes grain{0%{transform:translate(0,0)}20%{transform:translate(-23px,17px)}40%{transform:translate(31px,-12px)}60%{transform:translate(-14px,-29px)}80%{transform:translate(19px,26px)}100%{transform:translate(0,0)}}
.vignette{position:absolute;inset:0;background:radial-gradient(ellipse 72% 68% at 50% 46%,transparent 50%,rgba(0,0,0,.72));pointer-events:none;z-index:6}
`;

// The bars: in for the opening and the close, out for the tour.
const bars = (side) =>
  `<div class="bar" style="${side}:0;${keyed(`bar${side}`, [0, DURATION], [
    [0, "transform:none"],
    [S.reveal[0] + S.reveal[1] - 0.6, "transform:none"],
    [S.board[0] + 0.3, `transform:translateY(${side === "top" ? -BAR : BAR}px)`],
    [S.end[0] - 0.6, `transform:translateY(${side === "top" ? -BAR : BAR}px)`],
    [S.end[0] + 0.4, "transform:none"],
  ])}"></div>`;
/** An anamorphic flare crossing the frame at height y while the 3D sweep light passes. */
const flare = (name, y, [t0, t1]) =>
  `<div class="flare" style="top:${y}px;${keyed(name, [t0, t1 - t0], [
    [t0, "opacity:0;transform:scaleX(.3)"],
    [t0 + (t1 - t0) * 0.45, "opacity:1;transform:scaleX(1)"],
    [t1, "opacity:0;transform:scaleX(1.2)"],
  ])}"><i style="${keyed(`${name}Hot`, [t0, t1 - t0], [[t0, "left:420px"], [t1, "left:1500px"]])}"></i></div>`;

const html = `<div class="stage">
  <div class="fog" style="--k:fogA;width:1000px;height:760px;background:radial-gradient(closest-side,rgba(74,222,128,.22),transparent)"></div>
  <div class="fog" style="--k:fogB;width:900px;height:700px;background:radial-gradient(closest-side,rgba(94,234,212,.14),transparent)"></div>
  <div class="rays" style="${keyed("rays", [0, DURATION], [
    [0, "opacity:0"],
    [S.reveal[0] + 1.2, "opacity:0"],
    [S.reveal[0] + 2.4, "opacity:1"],
    [S.board[0] - 0.4, "opacity:0"],
    [S.end[0] + 0.6, "opacity:0"],
    [S.end[0] + 2, "opacity:1"],
  ])}"></div>
  <div class="c3d"><canvas id="c3d" width="${W}" height="${H}"></canvas><canvas id="c3dGlow" class="glow" width="${W / 2}" height="${H / 2}"></canvas></div>
  ${flare("flR", 382, [S.reveal[0] + 1.5, S.reveal[0] + 3.1])}
  ${flare("flE", 362, [S.end[0] + 1.7, S.end[0] + 3.1])}

  ${scene(
    "macro",
    `<p class="whisper in" style="position:absolute;left:150px;top:470px;${at(2.0)}"><span class="rule"></span>uspad.fun<br>presents</p>`,
  )}

  ${scene(
    "reveal",
    `<p class="center title" style="top:700px">${decode("$USPAD", 1.4)}<span class="thin in" style="${at(2.1)}"> is live.</span></p>
     <div class="center in" style="top:${H - BAR - 92}px;${at(2.6)}"><span class="pill"><i></i>The token of uspad.fun, on Solana mainnet</span></div>`,
  )}

  <div class="space"><div class="world">${world}</div></div>
  <div class="shade" style="${keyed("shade", [TOUR[0], TOUR[1] - TOUR[0]], [[TOUR[0], "opacity:0"], [TOUR[0] + 0.4, "opacity:1"], [TOUR[1] - 0.4, "opacity:1"], [TOUR[1], "opacity:0"]])}"></div>
  ${caption("board", "01", "The board", "Every coin, live.", "Trending, new, top payers and about to graduate. Search any coin or stock.")}
  ${caption("chart", "02", "Coin pages", "Chart it. Trade it.", "Live candles from 1 minute to 1 day, and buying or selling with SOL right beside them.")}
  ${caption("holders", "03", "Holders", "See who gets paid.", "Every holder's share, and the stock each one has received so far.")}
  ${caption("receipts", "04", "Payouts", "Every payout, on chain.", "A public receipt for every hourly round, down to its transaction.")}

  ${scene(
    "orbit",
    `<div class="low"></div>
     <p class="center h3" style="top:760px">${words("Every coin pays its holders", 0.4)}</p>
     <p class="center h3" style="top:842px">${words("in", 0.85)} ${words("US stocks,", 0.94, 0.09, "glowt")} ${words("every hour.", 1.12)}</p>
     <p class="center syms in" style="top:946px;${at(1.8)}">${STOCKS.map((s) => `<b>${s.symbol}</b>`).join("·")}</p>`,
  )}

  ${scene(
    "split",
    `<div class="ringw"><svg viewBox="0 0 520 520" width="520" height="520"><circle cx="260" cy="260" r="${R}" fill="none" stroke="rgba(134,239,172,.08)" stroke-width="40"/>${ring}</svg>
       <div class="ringc in" style="${at(0.5)}"><b>1.25%</b><span>on every trade</span></div></div>
     <div class="legend"><h4>${words("Where every trade goes.", 0.2, 0.07)}</h4>${SPLIT.map(
       ([l, v, c], i) => `<div class="row in" style="${at(0.55 + i * 0.28)}"><em style="background:${c}"></em>${l}<b>${v.toFixed(2)}%</b></div>`,
     ).join("")}</div>`,
  )}

  ${scene(
    "end",
    `<p class="center title" style="top:660px;font-size:156px">${decode("$USPAD", 0.6, 0.06)}</p>
     <div class="center in" style="top:846px;${at(1.6)}"><span class="cta">uspad.fun ${arrow}</span><span class="socials">@uspadfun · t.me/uspadfun</span></div>
     <p class="fine in" style="${at(2.4)}">Tickers can repeat on uspad: get $USPAD's address from @uspadfun. Tokenized stocks are issued by third parties and aren't available to US persons. Nothing here is financial advice.</p>`,
    "last",
  )}
  ${[S.board[0], S.orbit[0], S.split[0], S.end[0]].map((t) => `<div class="flash" style="--t:${t - 0.12}s"></div>`).join("")}
  ${bars("top")}${bars("bottom")}
  <div class="grain"></div>
  <div class="vignette"></div>
</div>`;


(async () => {
  const js = await bundle3d("token3d.ts");
  const stillsAt = process.argv.indexOf("--stills");
  await renderVideo({
    out: path.join(DIR, "social", "uspad-token-1920x1080.mp4"),
    width: W,
    height: H,
    fps: FPS,
    duration: DURATION,
    css: css + extraCss.join(""),
    html,
    crf: 16,
    workers: 3,
    // Two renders per frame: half the render time of four, with the same blur on fast moves.
    shutter: { samples: 2, angle: 180 },
    // WebGL in headless Chromium without a GPU.
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    prepare: async (page) => {
      await page.addScriptTag({ content: js });
      await page.evaluate(
        async ({ stocks, T }) => {
          window.__coins = await window.token3d.init(document.getElementById("c3d"), stocks, T, { glow: document.getElementById("c3dGlow") });
        },
        { stocks: STOCKS, T: { macro: S.macro, reveal: S.reveal, orbit: S.orbit, end: S.end } },
      );
    },
    frameHook: "__coins",
    stills: stillsAt > 0 ? { dir: process.argv[stillsAt + 1], times: [1.5, 3.5, 7.0, 8.4, 10.5, 13.4, 15.6, 17.6, 21.6, 25.8, 31, 36, 40.6, 43] } : undefined,
  });
  console.log(stillsAt > 0 ? "stills done" : "video done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
