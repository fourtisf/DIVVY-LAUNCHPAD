// "Anyone can launch" video for X (16:9, 1920 x 1080, 60 fps, H.264): uspad.fun is live and open to
// everyone, in three steps, on the real interface. The 3D coins are the site's own (three.js, from
// apps/web/src/three/scenes.ts via coins3d.ts), rendered frame by frame. Product shots are the site in
// demo mode with sample data, and the video says so. Every uspad fact matches the How it works page.
// Usage (repo root), after launch-shots.cjs:
//   node brand/uspad/src/launch-video.cjs brand/uspad [--stills <dir>]
//   python3 brand/uspad/src/launch-music.py brand/uspad          # the soundtrack
const fs = require("fs");
const path = require("path");
const { sized, stockLogo, guilloche, renderVideo } = require("./lib.cjs");

const DIR = process.argv[2];
const ROOT = path.resolve(DIR, "../..");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const shot = (dir, name) => `data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, "social", dir, `${name}.jpg`)).toString("base64")}`;
const W = 1920;
const H = 1080;
const FPS = 60;

// Scenes, [start, length] in seconds, on the 2-second bars of launch-music.py (120 BPM).
const S = { open: [0, 6], anyone: [6, 4], s1: [10, 6], s2: [16, 4], s3: [20, 6], paid: [26, 6], earn: [32, 4], cta: [36, 8] };
const DURATION = S.cta[0] + S.cta[1];
const scene = (k, inner, cls = "") => `<section class="scn ${cls}" style="--s:${S[k][0]}s;--d:${S[k][1]}s">${inner}</section>`;
const at = (o) => `--o:${o}s`;

// The six stocks around the hero coin, with the colours the site gives them (apps/api/src/mock/data.ts).
const STOCKS = [
  ["NVDAx", "NV", "Nvidia", "#76B900", "#0D2200"],
  ["SPYx", "SPY", "S&P 500", "#6D88FF", "#0B1440"],
  ["TSLAx", "TS", "Tesla", "#EF5A65", "#3A0A10"],
  ["AAPLx", "AP", "Apple", "#E1E5EA", "#1B1F27"],
  ["QQQx", "QQQ", "Nasdaq 100", "#3CCBEB", "#06303A"],
  ["MSTRx", "MS", "Strategy", "#F7931A", "#331A00"],
].map(([symbol, mono, name, bg, fg]) => ({ symbol, mono, name, bg, fg, logo: stockLogo(DIR, symbol) }));

/** Words that rise out of a mask one after another. `parts` are [text, class] pairs. */
const words = (parts, o, step = 0.11) => {
  let i = 0;
  return parts
    .map(([text, cls = ""]) =>
      text
        .split(" ")
        .map((w) => `<span class="wm"><span class="wi ${cls}" style="${at(o + step * i++)}">${w}</span></span>`)
        .join(" "),
    )
    .join(" ");
};

/** Where a product shot (2880 x 1800, a 1440 x 900 page at 2x) sits so its region x, y, width fills `vw` px. */
const region = ([x, y, w], vw) => {
  const s = vw / w;
  return `translate(${(-x * s).toFixed(1)}px,${(-y * s).toFixed(1)}px) scale(${s.toFixed(4)})`;
};
const camKeys = (name, vw, stops) =>
  `@keyframes ${name}{${stops.map(([p, r]) => `${p}%{transform:${region(r, vw)}}`).join("")}}`;

/** A browser window around a product shot, tilted in 3D, the shot moved by the `cam` keyframes. */
const browser = ({ x, y, w, url, img, cam, o = 0.15, cls = "" }) => {
  const h = Math.round((w * 10) / 16);
  return `<div class="tilt ${cls}" style="left:${x}px;top:${y}px;width:${w}px;${at(o)}"><div class="win">
    <div class="bar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i><span class="url">${lock}${url}</span></div>
    <div class="vp" style="height:${h}px"><img src="${img}" style="animation:${cam} var(--d) cubic-bezier(.45,0,.2,1) var(--s) both"></div>
    <span class="sample">Interface preview, sample data</span>
  </div></div>`;
};

/** One region of a shot on a floating glass card, with a slow push in. */
const card = ({ x, y, w, img, from, to, name, o = 0.2, cls = "" }) => {
  const h = Math.round((w * from[3]) / from[2]);
  const keys = `@keyframes ${name}{from{transform:${region(from, w)}}to{transform:${region(to, w)}}}`;
  extraCss.push(keys);
  return `<div class="tilt ${cls}" style="left:${x}px;top:${y}px;width:${w}px;${at(o)}"><div class="crop" style="height:${h}px">
    <img src="${img}" style="animation:${name} var(--d) cubic-bezier(.45,0,.2,1) var(--s) both">
    <span class="sample">Interface preview, sample data</span>
  </div></div>`;
};
const extraCss = [];

const lock = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const check = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06210F" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
const arrow = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const stepHead = (n, title, body, o = 0.15) => `
  <div class="stepchip in" style="${at(o)}"><b>${n}</b>Step ${n} of 3</div>
  <p class="h2">${title.map((line, i) => words([[line]], o + 0.25 + i * 0.28, 0.08)).join("<br>")}</p>
  ${body ? `<p class="body in" style="${at(o + 0.9)}">${body}</p>` : ""}`;

// The odometer for 0.15%: each digit column rolls to its digit.
const roll = (digit, o, turns) => {
  const seq = Array.from({ length: turns * 10 + digit + 1 }, (_, i) => i % 10);
  const k = `roll${digit}${turns}`;
  extraCss.push(`@keyframes ${k}{from{transform:translateY(0)}to{transform:translateY(-${seq.length - 1}em)}}`);
  return `<span class="odo"><span class="col" style="animation:${k} 1.5s cubic-bezier(.16,1,.3,1) calc(var(--s) + ${o}s) both">${seq.map((d) => `<i>${d}</i>`).join("")}</span></span>`;
};

// Depth of field on the 3D layer while "Anyone can launch a coin." is on screen.
const p = (t) => ((t / DURATION) * 100).toFixed(3);
const dof = `@keyframes dof{0%{filter:none}${p(S.anyone[0])}%{filter:none}${p(S.anyone[0] + 0.7)}%{filter:blur(14px)}${p(S.anyone[0] + S.anyone[1])}%{filter:blur(14px)}${p(S.anyone[0] + S.anyone[1] + 0.01)}%{filter:none}100%{filter:none}}`;

const grain = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}`;

// Product shot regions [x, y, width, height] in shot pixels (launch-shots.cjs and live-shots.cjs).
// create: the whole form, then the dividend picker; never the demo's "Cost to launch" box (x > 1860, y > 1500).
const CREATE_ALL = [240, 0, 2400];
const CREATE_PICK = [190, 560, 1600];
const MODAL = [961, 391, 958, 1018];
const MODAL_IN = [981, 431, 918, 975];
const LAUNCHED = [961, 385, 958, 1030];
const LAUNCHED_IN = [981, 415, 918, 987];
const COIN_ALL = [0, 0, 2880];
const COIN_IN = [700, 170, 2000];

const css = `
.stage{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#050806}
.bg{position:absolute;inset:0;background:radial-gradient(1400px 800px at 50% 118%,rgba(74,222,128,.13),transparent 70%),radial-gradient(1000px 600px at 50% -12%,rgba(126,242,216,.07),transparent 70%),linear-gradient(180deg,#09120E,#050806)}
.leak{position:absolute;border-radius:50%;filter:blur(90px);mix-blend-mode:screen;animation:var(--k) ${DURATION}s linear 0s both}
@keyframes leakA{0%{transform:translate(-200px,-120px)}25%{transform:translate(900px,40px)}50%{transform:translate(1300px,520px)}75%{transform:translate(300px,640px)}100%{transform:translate(700px,-80px)}}
@keyframes leakB{0%{transform:translate(1500px,700px)}30%{transform:translate(200px,500px)}60%{transform:translate(1000px,-100px)}100%{transform:translate(1400px,300px)}}
.beam{position:absolute;left:960px;top:-200px;width:2400px;height:1600px;transform-origin:50% 0;background:conic-gradient(from 180deg at 50% 0,transparent 168deg,rgba(182,255,210,.07) 176deg,rgba(182,255,210,.12) 180deg,rgba(182,255,210,.07) 184deg,transparent 192deg);margin-left:-1200px;animation:beam ${DURATION}s ease-in-out 0s both;mix-blend-mode:screen}
@keyframes beam{0%{transform:rotate(-14deg);opacity:0}6%{opacity:1}50%{transform:rotate(10deg)}100%{transform:rotate(-6deg);opacity:.8}}
.grain{position:absolute;inset:-80px;background-image:url("${grain}");opacity:.075;mix-blend-mode:overlay;animation:grain .5s steps(5) 0s infinite}
@keyframes grain{0%{transform:translate(0,0)}20%{transform:translate(-23px,17px)}40%{transform:translate(31px,-12px)}60%{transform:translate(-14px,-29px)}80%{transform:translate(19px,26px)}100%{transform:translate(0,0)}}
.vignette{position:absolute;inset:0;background:radial-gradient(ellipse 75% 70% at 50% 46%,transparent 55%,rgba(0,0,0,.62));pointer-events:none}
.c3d{position:absolute;inset:0;animation:dof ${DURATION}s linear 0s both}
.c3d canvas{display:block;width:${W}px;height:${H}px}
${dof}
.scn{position:absolute;inset:0;opacity:0;animation:scn var(--d) linear var(--s) both}
.scn.last{animation-name:scnLast}
@keyframes scn{0%{opacity:0;filter:blur(16px);transform:scale(1.045)}8%{opacity:1;filter:none;transform:none}93%{opacity:1;filter:none;transform:none}100%{opacity:0;filter:blur(12px);transform:scale(.98)}}
@keyframes scnLast{0%{opacity:0;filter:blur(16px);transform:scale(1.045)}6%{opacity:1;filter:none;transform:none}100%{opacity:1;filter:none;transform:none}}
.center{position:absolute;left:0;right:0;text-align:center}
.wm{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .02em .1em;margin-bottom:-.1em}
.wi{display:inline-block;animation:wordIn 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
@keyframes wordIn{from{transform:translateY(108%) rotate(4deg);filter:blur(12px);opacity:0}to{transform:none;filter:none;opacity:1}}
.metal{background-image:linear-gradient(100deg,transparent 0 38%,rgba(255,255,255,.95) 50%,transparent 62% 100%),linear-gradient(180deg,#FFFFFF 0%,#E3F8EC 50%,#9CC6AF 100%);background-size:300% 100%,100% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;color:transparent;animation:wordIn 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both,sheen 1.8s cubic-bezier(.45,0,.2,1) calc(var(--s) + var(--o) + .9s) both}
.glow{background-image:linear-gradient(100deg,transparent 0 38%,rgba(255,255,255,.9) 50%,transparent 62% 100%),linear-gradient(100deg,#C9FFE0,#4ADE80 45%,#D9F99D);background-size:300% 100%,100% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 28px rgba(74,222,128,.35));animation:wordIn 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both,sheen 1.8s cubic-bezier(.45,0,.2,1) calc(var(--s) + var(--o) + .9s) both}
@keyframes sheen{from{background-position:120% 0,0 0}to{background-position:-20% 0,0 0}}
.hero{font:600 132px/1 'Inter Display',Inter;letter-spacing:-.05em;margin:0}
.big{font:600 156px/1 'Inter Display',Inter;letter-spacing:-.055em;margin:0}
.h2{font:600 78px/1.02 'Inter Display',Inter;letter-spacing:-.045em;margin:0;color:#F2FFF7}
.h3{font:600 86px/1.04 'Inter Display',Inter;letter-spacing:-.045em;margin:0;color:#F2FFF7}
.lede{font:400 31px/1.45 Inter;color:#A9BDB3;margin:0}
.body{font:400 29px/1.5 Inter;color:#A9BDB3;margin:28px 0 0;max-width:640px}
.in{animation:rise .9s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o,0s)) both}
@keyframes rise{from{opacity:0;transform:translateY(26px);filter:blur(8px)}to{opacity:1;transform:none;filter:none}}
.pill{display:inline-flex;align-items:center;gap:12px;font:500 24px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.24);background:rgba(74,222,128,.07);padding:10px 22px;border-radius:999px;backdrop-filter:blur(8px)}
.pill i{width:11px;height:11px;border-radius:50%;background:#4ADE80;box-shadow:0 0 14px #4ADE80;animation:pulse 1.2s ease-in-out 0s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.75)}50%{box-shadow:0 0 0 11px rgba(74,222,128,0)}}
.flare{position:absolute;left:0;right:0;top:357px;height:3px;background:linear-gradient(90deg,transparent,rgba(182,255,210,.95) 50%,transparent);filter:blur(1px);box-shadow:0 0 30px 6px rgba(74,222,128,.35);transform:scaleX(0);animation:flare 1.6s cubic-bezier(.2,.7,.2,1) .15s both}
@keyframes flare{0%{transform:scaleX(0);opacity:0}25%{opacity:1}100%{transform:scaleX(1.2);opacity:0}}
.uline{position:absolute;left:560px;width:800px;height:3px;border-radius:3px;background:linear-gradient(90deg,transparent,#4ADE80,#D9F99D,transparent);box-shadow:0 0 22px rgba(74,222,128,.7);transform-origin:50% 50%;animation:uline 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
@keyframes uline{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
.left{position:absolute;left:120px;top:270px;width:680px}
.stepchip{display:inline-flex;align-items:center;gap:14px;font:500 23px Inter;color:#C9E8D6;margin-bottom:30px}
.stepchip b{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font:700 21px 'Inter Display',Inter;color:#06210F;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8);box-shadow:inset 0 0 0 2px rgba(255,255,255,.45),0 0 28px -4px rgba(74,222,128,.7)}
.tilt{position:absolute;transform-origin:50% 50%;animation:tilt var(--d) cubic-bezier(.2,.7,.2,1) calc(var(--s) + var(--o)) both}
@keyframes tilt{from{opacity:0;transform:perspective(2600px) translate3d(90px,30px,-160px) rotateY(-24deg) rotateX(8deg)}12%{opacity:1}to{opacity:1;transform:perspective(2600px) translate3d(0,0,0) rotateY(-9deg) rotateX(3deg)}}
.tilt.front{animation-name:tiltFront}
@keyframes tiltFront{from{opacity:0;transform:perspective(2000px) translate3d(-40px,90px,120px) rotateY(16deg) rotateX(10deg) scale(.9)}14%{opacity:1}to{opacity:1;transform:perspective(2000px) translate3d(0,0,40px) rotateY(6deg) rotateX(2deg)}}
.tilt.back .win{filter:brightness(.62) saturate(.9)}
.win,.crop{position:relative;border-radius:22px;overflow:hidden;background:#0B110E;box-shadow:0 0 0 1px rgba(134,239,172,.24),0 60px 140px -30px rgba(0,0,0,.95),0 0 140px -40px rgba(74,222,128,.5);-webkit-box-reflect:below 16px linear-gradient(transparent 72%,rgba(255,255,255,.10))}
.win::after,.crop::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 36%,rgba(255,255,255,.11) 47%,rgba(255,255,255,.03) 53%,transparent 62%);transform:translateX(-130%);animation:glass 1.8s cubic-bezier(.45,0,.2,1) calc(var(--s) + 1.1s) both;pointer-events:none}
@keyframes glass{to{transform:translateX(130%)}}
.win .bar{height:44px;display:flex;align-items:center;gap:9px;padding:0 18px;background:#101814;border-bottom:1px solid rgba(255,255,255,.05)}
.win .bar i{width:13px;height:13px;border-radius:50%}
.win .url{margin:0 auto;display:flex;align-items:center;gap:8px;font:500 17px Inter;color:#97ACA2;background:rgba(255,255,255,.045);border-radius:10px;padding:6px 18px;transform:translateX(-28px)}
.vp{position:relative;overflow:hidden}
.win img,.crop img{display:block;width:2880px;height:1800px;max-width:none;transform-origin:0 0}
.sample{position:absolute;right:14px;bottom:12px;font:500 14px Inter;color:#C9E8D6;background:rgba(7,11,9,.8);border:1px solid rgba(134,239,172,.18);padding:5px 12px;border-radius:999px;z-index:2}
.hl{position:absolute;border-radius:14px;border:1.5px solid rgba(134,239,172,.9);background:rgba(74,222,128,.10);box-shadow:0 0 0 6px rgba(74,222,128,.10),0 0 40px rgba(74,222,128,.45);animation:hl 1.2s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both;z-index:2}
@keyframes hl{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
.badge{position:absolute;display:flex;align-items:center;gap:12px;font:600 23px Inter;color:#EAFBF1;background:rgba(14,24,19,.82);border:1px solid rgba(134,239,172,.3);padding:12px 22px 12px 12px;border-radius:999px;box-shadow:0 24px 60px -20px rgba(0,0,0,.9),0 0 40px -10px rgba(74,222,128,.5);backdrop-filter:blur(10px);animation:pop .8s cubic-bezier(.34,1.56,.64,1) calc(var(--s) + var(--o)) both}
.badge .ck,.tag .ck{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8)}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
.tags{display:flex;flex-direction:column;gap:16px;margin-top:34px}
.tag{display:inline-flex;align-self:flex-start;align-items:center;gap:14px;font:500 27px Inter;color:#EAFBF1}
.tag .ck{width:36px;height:36px}
.logos{display:flex;gap:14px;margin-top:34px}
.logos img{width:58px;height:58px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.2),0 14px 30px -10px rgba(0,0,0,.8),0 0 26px -6px rgba(74,222,128,.5);animation:pop .7s cubic-bezier(.34,1.56,.64,1) calc(var(--s) + var(--o)) both}
.sym{position:absolute;top:468px;transform:translateX(-50%);font:600 21px Inter;color:#C9E8D6;background:rgba(7,11,9,.7);border:1px solid rgba(134,239,172,.18);padding:4px 13px;border-radius:999px;animation:rise .8s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
.odo{display:inline-block;height:1em;overflow:hidden;vertical-align:top}
.odo .col{display:flex;flex-direction:column}
.odo i{font-style:normal;height:1em;line-height:1em}
.num{font:600 280px/1 'Inter Display',Inter;letter-spacing:-.06em;margin:0;display:flex;justify-content:center;filter:drop-shadow(0 0 50px rgba(74,222,128,.35))}
.num i,.num>span:not(.odo){background:linear-gradient(180deg,#F2FFF7 0%,#9AF5BC 55%,#36C26F 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.splits{display:flex;justify-content:center;gap:16px}
.fchip{display:inline-flex;align-items:center;gap:12px;font:500 25px Inter;color:#C9E8D6;padding:12px 22px;border-radius:999px;background:rgba(17,27,22,.8);border:1px solid rgba(134,239,172,.16)}
.fchip em{width:12px;height:12px;border-radius:4px}
.fchip b{color:#EAFBF1;font-weight:700}
.cta{display:inline-flex;align-items:center;gap:16px;font:700 40px 'Inter Display',Inter;letter-spacing:-.02em;color:#06210F;background:linear-gradient(100deg,#C9FFE0,#4ADE80 45%,#D9F99D);padding:22px 46px;border-radius:999px;box-shadow:0 24px 70px -18px rgba(74,222,128,.85),inset 0 0 0 2px rgba(255,255,255,.4);position:relative;overflow:hidden}
.cta::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);transform:translateX(-130%);animation:glass 1.4s cubic-bezier(.45,0,.2,1) calc(var(--s) + 2.6s) both}
.socials{font:500 26px Inter;color:#97ACA2}
.fine{position:absolute;left:0;right:0;bottom:30px;text-align:center;font:400 17px Inter;color:#5F766B}
`;

const html = `<div class="stage">
  <div class="bg"></div>
  <div class="leak" style="--k:leakA;width:900px;height:700px;background:radial-gradient(closest-side,rgba(74,222,128,.26),transparent)"></div>
  <div class="leak" style="--k:leakB;width:800px;height:640px;background:radial-gradient(closest-side,rgba(126,242,216,.16),transparent)"></div>
  <div class="beam"></div>
  ${guilloche(W, H, 44, 15, 0.035)}
  <div class="c3d"><canvas id="c3d" width="${W}" height="${H}"></canvas></div>
  <div class="flare"></div>

  ${scene(
    "open",
    `<div class="center in" style="top:664px;${at(2.0)}"><span class="pill"><i></i>Live on Solana mainnet</span></div>
     <p class="center hero" style="top:742px">${words([["uspad.fun", "metal"], ["is", "metal"], ["live.", "glow"]], 2.4, 0.14)}</p>
     <p class="center lede in" style="top:908px;${at(3.3)}">Memecoins that pay their holders in US stocks, every hour.</p>`,
  )}

  ${scene(
    "anyone",
    `<p class="center big" style="top:286px">${words([["Anyone", "glow"], ["can", "metal"]], 0.12, 0.13)}</p>
     <p class="center big" style="top:462px">${words([["launch a coin.", "metal"]], 0.4, 0.13)}</p>
     <div class="uline" style="top:668px;${at(1.1)}"></div>
     <p class="center lede in" style="top:716px;font-size:36px;${at(1.3)}">Three steps. Live in seconds.</p>`,
  )}

  ${scene(
    "s1",
    `<div class="left">${stepHead(1, ["Name it.", "Pick the stock."], "Name, ticker and picture, and the stock token its holders earn: NVDAx, SPYx, TSLAx and more.")}
       <div class="logos">${STOCKS.map((s, i) => `<img src="${s.logo}" style="${at(1.5 + i * 0.1)}">`).join("")}</div>
     </div>
     ${browser({ x: 840, y: 190, w: 980, url: "uspad.fun/create", img: shot("launch-shots", "create"), cam: "camCreate" })}`,
  )}

  ${scene(
    "s2",
    `<div class="left">${stepHead(2, ["Approve once,", "in your wallet."], "Your wallet signs and pays for the create, so the coin's creator on chain is you.")}</div>
     ${card({ x: 1030, y: 150, w: 600, img: shot("launch-shots", "modal"), from: MODAL, to: MODAL_IN, name: "camModal", o: 0.1, cls: "front" }).replace(
       "</div></div>",
       `<div class="hl" style="left:22px;top:370px;width:556px;height:68px;${at(0.9)}"></div></div></div>`,
     )}
     <div class="badge" style="left:930px;top:790px;${at(1.5)}"><span class="ck">${check}</span>Signed by your wallet</div>`,
  )}

  ${scene(
    "s3",
    `<div class="left">${stepHead(3, ["Live in one", "private bundle."], "", 0.15)}
       <div class="tags">${["No snipers in its first block", "No dev buy, no team tokens", "Trading starts at once"].map((t, i) => `<span class="tag in" style="${at(1.0 + i * 0.22)}"><span class="ck">${check}</span>${t}</span>`).join("")}</div>
     </div>
     ${browser({ x: 960, y: 120, w: 880, url: "uspad.fun/coin/MOONCAT", img: shot("live-shots", "coin"), cam: "camCoin", o: 0.05, cls: "back" })}
     ${card({ x: 850, y: 330, w: 470, img: shot("launch-shots", "launched"), from: LAUNCHED, to: LAUNCHED_IN, name: "camLaunched", o: 0.45, cls: "front" })}`,
  )}

  ${scene(
    "paid",
    `${STOCKS.map((s, i) => `<span class="sym" style="left:${960 + (i - 2.5) * 296}px;${at(1.05 + i * 0.16)}">${s.symbol}</span>`).join("")}
     <p class="center h3" style="top:560px">${words([["Its holders get paid"]], 0.5, 0.1)}</p>
     <p class="center h3" style="top:656px">${words([["in", "metal"], ["US stocks,", "glow"], ["every hour.", "metal"]], 0.85, 0.1)}</p>
     <p class="center lede in" style="top:806px;${at(1.8)}">Hold $10 or more of a coin and its stock lands in your wallet,<br>with an on-chain receipt for every payout.</p>`,
  )}

  ${scene(
    "earn",
    `<p class="center lede in" style="top:196px;font-size:44px;color:#C9E8D6;${at(0.1)}">Creators earn</p>
     <div class="center" style="top:270px"><p class="num">${roll(0, 0.3, 1)}<span>.</span>${roll(1, 0.4, 1)}${roll(5, 0.5, 1)}<span>%</span></p></div>
     <p class="center lede in" style="top:586px;font-size:44px;color:#C9E8D6;${at(0.9)}">of every trade on the curve, from the coin they launch.</p>
     <div class="splits center in" style="top:720px;${at(1.5)}">${[
       ["Holders", "0.50%", "#4ADE80"],
       ["Creator", "0.15%", "#5EEAD4"],
       ["uspad", "0.35%", "#D9F99D"],
       ["Raydium", "0.25%", "#3A4A42"],
     ]
       .map(([l, v, c]) => `<span class="fchip"><em style="background:${c}"></em>${l}<b>${v}</b></span>`)
       .join("")}</div>
     <p class="center in" style="top:810px;font:400 22px Inter;color:#6E857A;${at(1.8)}">1.25% per trade on the bonding curve.</p>`,
  )}

  ${scene(
    "cta",
    `<p class="center hero" style="top:640px">${words([["Launch", "metal"], ["yours.", "glow"]], 0.9, 0.16)}</p>
     <div class="center in" style="top:808px;${at(1.7)}"><span class="cta">uspad.fun ${arrow}</span></div>
     <p class="center socials in" style="top:930px;${at(2.2)}">@uspadfun · t.me/uspadfun</p>
     <p class="fine in" style="${at(2.6)}">Interface previews show sample data. Tokenized stocks are issued by third parties and aren't available to US persons. Nothing here is financial advice.</p>`,
    "last",
  )}
  <div class="grain"></div>
  <div class="vignette"></div>
</div>`;

const cams = [
  camKeys("camCreate", 980, [[0, CREATE_ALL], [18, CREATE_ALL], [82, CREATE_PICK], [100, CREATE_PICK]]),
  camKeys("camCoin", 880, [[0, COIN_ALL], [100, COIN_IN]]),
].join("");

async function bundle3d() {
  const esbuild = require(path.join(ROOT, "node_modules/.pnpm/node_modules/esbuild"));
  const r = await esbuild.build({
    entryPoints: [path.join(__dirname, "coins3d.ts")],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    nodePaths: [path.join(ROOT, "apps/web/node_modules")],
    logLevel: "error",
  });
  return r.outputFiles[0].text;
}

(async () => {
  const js = await bundle3d();
  const stillsAt = process.argv.indexOf("--stills");
  await renderVideo({
    out: path.join(DIR, "social", "uspad-launch-1920x1080.mp4"),
    width: W,
    height: H,
    fps: FPS,
    duration: DURATION,
    css: css + cams + extraCss.join(""),
    html,
    crf: 16,
    workers: 3,
    // WebGL in headless Chromium without a GPU.
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    prepare: async (page) => {
      await page.addScriptTag({ content: js });
      await page.evaluate(
        async ({ stocks, T }) => {
          window.__coins = await window.coins3d.init(document.getElementById("c3d"), stocks, T);
        },
        { stocks: STOCKS, T: { open: S.open, anyone: S.anyone, paid: S.paid, cta: S.cta } },
      );
    },
    frameHook: "__coins",
    stills: stillsAt > 0 ? { dir: process.argv[stillsAt + 1], times: [1.5, 4.5, 8, 13, 15, 18.5, 23.5, 29.5, 34.5, 41] } : undefined,
  });
  console.log(stillsAt > 0 ? "stills done" : "video done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
