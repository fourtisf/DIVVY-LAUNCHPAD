// "$USPAD is live" video for X (16:9, 1920 x 1080, 30 fps with film motion blur, H.264): the uspad token
// is live, then a look around uspad.fun on the live site. It names the ticker only: no contract address
// anywhere (owner request 2026-10-28), and the closing line sends people to @uspadfun for it, since
// tickers can repeat on uspad. The shots are the owner's screenshots of the live site
// (social/token-shots, with the addresses painted over), so its numbers are real at that moment.
// Usage (repo root):
//   node brand/uspad/src/token-video.cjs brand/uspad [--stills <dir>]
//   python3 brand/uspad/src/token-music.py brand/uspad          # the soundtrack
const fs = require("fs");
const path = require("path");
const { sized, stockLogo, guilloche, renderVideo } = require("./lib.cjs");

const DIR = process.argv[2];
const ROOT = path.resolve(DIR, "../..");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const live = (name) => `data:image/jpeg;base64,${fs.readFileSync(path.join(DIR, "social", "token-shots", `${name}.jpg`)).toString("base64")}`;
const W = 1920;
const H = 1080;
const FPS = 30;


// Scenes, [start, length] in seconds, on the 2-second bars of token-music.py (120 BPM).
const S = { sting: [0, 4], open: [4, 6], tour: [10, 2], board: [12, 6], coin: [18, 6], holders: [24, 4], paid: [28, 6], payouts: [34, 4], fees: [38, 4], cta: [42, 6] };
const DURATION = S.cta[0] + S.cta[1];
const scene = (k, inner, cls = "") => `<section class="scn ${cls}" style="--s:${S[k][0]}s;--d:${S[k][1]}s">${inner}</section>`;
const at = (o) => `--o:${o}s`;
const extraCss = [];
/** Keyframes over a whole scene from [second, css] pairs; `step` holds each value until the next. */
const timeline = (name, k, stops, step = false) => {
  const d = S[k][1];
  // Without explicit 0% and 100% keyframes the browser eases back to the element's own style.
  const all = [...(stops[0][0] > 0 ? [[0, stops[0][1]]] : []), ...stops, ...(stops[stops.length - 1][0] < d ? [[d, stops[stops.length - 1][1]]] : [])];
  extraCss.push(`@keyframes ${name}{${all.map(([t, v]) => `${((t / d) * 100).toFixed(3)}%{${v}}`).join("")}}`);
  return `animation:${name} ${d}s ${step ? "step-end" : "cubic-bezier(.45,0,.2,1)"} ${S[k][0]}s both`;
};

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

/** Where a product shot sits so its region x, y, width fills `vw` px. */
const region = ([x, y, w], vw) => {
  const s = vw / w;
  return `translate(${(-x * s).toFixed(1)}px,${(-y * s).toFixed(1)}px) scale(${s.toFixed(4)})`;
};
const lock = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const arrow = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
// The odometer for 1.25%: each digit column rolls to its digit.
const roll = (digit, o, turns) => {
  const seq = Array.from({ length: turns * 10 + digit + 1 }, (_, i) => i % 10);
  const k = `roll${digit}${turns}`;
  extraCss.push(`@keyframes ${k}{from{transform:translateY(0)}to{transform:translateY(-${seq.length - 1}em)}}`);
  return `<span class="odo"><span class="col" style="animation:${k} 1.5s cubic-bezier(.16,1,.3,1) calc(var(--s) + ${o}s) both">${seq.map((d) => `<i>${d}</i>`).join("")}</span></span>`;
};


/** A page of the live site in a browser window: the camera moves from one region [x, y, w] of the shot
 * to another over the scene; `then` crossfades to a second shot (with its own regions) at `at` s. */
const page = ({ k, x = 800, y = 190, w = 1040, h = 562, url = "uspad.fun", shot, from, to, then, o = 0.15 }) => {
  const cam = (img, name, a, b, extra = "") => {
    extraCss.push(`@keyframes ${name}{from{transform:${region(a, w)}}to{transform:${region(b, w)}}}`);
    return `<img class="live" src="${img}" style="animation:${name} ${S[k][1]}s cubic-bezier(.45,0,.2,1) ${S[k][0]}s both${extra}">`;
  };
  const second = then
    ? cam(live(then.shot), `${k}Cam2`, then.from, then.to, `,${k}Swap ${S[k][1]}s linear ${S[k][0]}s both`) +
      `<style>@keyframes ${k}Swap{0%,${((then.at / S[k][1]) * 100).toFixed(1)}%{opacity:0}${(((then.at + 0.6) / S[k][1]) * 100).toFixed(1)}%,100%{opacity:1}}</style>`
    : "";
  return `<div class="tilt flat" style="left:${x}px;top:${y}px;width:${w}px;${at(o)}"><div class="win">
    <div class="bar"><i style="background:#FF5F57"></i><i style="background:#FEBC2E"></i><i style="background:#28C840"></i><span class="url">${lock}${url}</span></div>
    <div class="vp" style="height:${h}px">${cam(live(shot), `${k}Cam`, from, to)}${second}</div>
    <span class="sample">Live on uspad.fun</span>
  </div></div>`;
};

/** A feature: its label, a two-line title and a line of text, on the left. */
const feature = (label, title, body, o = 0.15) => `<div class="left">
  <div class="kick in" style="${at(o)}"><i></i>${label}</div>
  <p class="h2">${title.map((line, i) => words([[line]], o + 0.25 + i * 0.28, 0.08)).join("<br>")}</p>
  <p class="body in" style="${at(o + 0.9)}">${body}</p>
</div>`;

// Depth of field on the 3D layer while "Inside uspad.fun" is on screen.
const p = (t) => ((t / DURATION) * 100).toFixed(3);
const dof = `@keyframes dof{0%{filter:none}${p(S.tour[0])}%{filter:none}${p(S.tour[0] + 0.5)}%{filter:blur(14px)}${p(S.tour[0] + S.tour[1])}%{filter:blur(14px)}${p(S.tour[0] + S.tour[1] + 0.01)}%{filter:none}100%{filter:none}}`;
const grain = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}`;

/* ---------- the Koin belah sting ---------- */

// mark.svg, split into its two halves (each with its own inner ring, highlight and sheen).
const FOIL = `<defs><linearGradient id="vf" x1="0" y1=".2" x2="1" y2=".8"><stop offset="0" stop-color="#C9FFE0"/><stop offset="0.26" stop-color="#86EFAC"/><stop offset="0.52" stop-color="#E4FFA6"/><stop offset="0.76" stop-color="#7EF2D8"/><stop offset="1" stop-color="#C9FFE0"/></linearGradient><radialGradient id="vs" cx=".32" cy=".22" r=".75"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".55"/><stop offset=".45" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient></defs>`;
const half = (d, ring, hi) =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%" style="position:absolute;inset:0;overflow:visible">${FOIL}<path d="${d}" fill="url(#vf)"/><path d="${ring}" fill="none" stroke="#03140A" stroke-opacity=".28" stroke-width="1.6"/><path d="${hi}" fill="none" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="1.1"/><path d="${d}" fill="url(#vs)"/></svg>`;
const LEFT = half("M46.8 13.5A40 40 0 0 0 46.8 93.5Z", "M46.8 22.5A31 31 0 0 0 46.8 84.5", "M46.8 14.7A38.8 38.8 0 0 0 46.8 92.3");
const RIGHT = half("M53.2 6.5A40 40 0 0 1 53.2 86.5Z", "M53.2 15.5A31 31 0 0 1 53.2 77.5", "M53.2 7.7A38.8 38.8 0 0 1 53.2 85.3");
const markMask = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M46.8 13.5A40 40 0 0 0 46.8 93.5ZM53.2 6.5A40 40 0 0 1 53.2 86.5Z'/></svg>`)}")`;
// The lockup (lockup-dark.svg: the mark at 0.84 scale, the word from x 106 of 317.06) at 760 px wide.
const LK = { w: 760, left: 580, top: 412 };
const LK_K = LK.w / 317.06;
const MARK_AT = { x: LK.left, y: LK.top + 6 * LK_K, size: 84 * LK_K };
const MK = { size: 270, x: 960 - 135, y: 540 - 135 };

const sting = scene(
  "sting",
  `<div class="mk" style="left:${MK.x}px;top:${MK.y}px;width:${MK.size}px;height:${MK.size}px;${timeline("mkMove", "sting", [
    [0, "transform:none"],
    [1.65, "transform:none"],
    [2.35, `transform:translate(${(MARK_AT.x - MK.x).toFixed(1)}px,${(MARK_AT.y - MK.y).toFixed(1)}px) scale(${(MARK_AT.size / MK.size).toFixed(4)})`],
  ])}">
     <div class="hf" style="${timeline("hL", "sting", [[0, "transform:translateX(-640px) rotate(-38deg);opacity:0"], [0.25, "transform:translateX(-640px) rotate(-38deg);opacity:0"], [0.4, "opacity:1"], [0.95, "transform:none;opacity:1"]])}">${LEFT}</div>
     <div class="hf" style="${timeline("hR", "sting", [[0, "transform:translateX(640px) rotate(38deg);opacity:0"], [0.25, "transform:translateX(640px) rotate(38deg);opacity:0"], [0.4, "opacity:1"], [0.95, "transform:none;opacity:1"]])}">${RIGHT}</div>
     <div class="sheen2" style="-webkit-mask-image:${markMask};mask-image:${markMask};${timeline("sh2", "sting", [[0, "background-position:150% 0"], [1.05, "background-position:150% 0"], [1.75, "background-position:-50% 0"]])}"></div>
   </div>
   <div class="flash" style="${timeline("fl", "sting", [[0, "opacity:0;transform:scale(.2)"], [0.93, "opacity:0;transform:scale(.2)"], [1.0, "opacity:1;transform:scale(.8)"], [1.6, "opacity:0;transform:scale(1.6)"]])}"></div>
   <div class="streak" style="${timeline("stk", "sting", [[0, "opacity:0;transform:scaleX(.05)"], [0.94, "opacity:0;transform:scaleX(.05)"], [1.02, "opacity:1;transform:scaleX(.7)"], [1.7, "opacity:0;transform:scaleX(1.3)"]])}"></div>
   <div class="shock" style="${timeline("sk", "sting", [[0, "opacity:0;transform:translate(-50%,-50%) scale(.3)"], [0.95, "opacity:.9;transform:translate(-50%,-50%) scale(.3)"], [1.9, "opacity:0;transform:translate(-50%,-50%) scale(2.6)"]])}"></div>
   <div class="lk" style="left:${LK.left}px;top:${LK.top}px;width:${LK.w}px;${timeline("lkIn", "sting", [
     [0, "clip-path:inset(0 68.5% 0 31.5%);filter:blur(10px);opacity:0"],
     [1.95, "clip-path:inset(0 68.5% 0 31.5%);filter:blur(10px);opacity:0"],
     [2.1, "opacity:1"],
     [2.75, "clip-path:inset(0 0 0 31.5%);filter:none;opacity:1"],
   ])}">${sized(read("lockup-dark.svg"), LK.w)}</div>
   <p class="center lede" style="top:700px;${timeline("tag", "sting", [[0, "opacity:0;transform:translateY(18px)"], [2.55, "opacity:0;transform:translateY(18px)"], [3.1, "opacity:1;transform:none"]])}">The stock-dividend launchpad on Solana</p>`,
);

const css = `
.vp>img.live{width:auto;height:auto}
.kick{display:inline-flex;align-items:center;gap:12px;font:500 24px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.24);background:rgba(74,222,128,.07);padding:9px 20px;border-radius:999px;margin-bottom:30px}
.kick i{width:10px;height:10px;border-radius:50%;background:#4ADE80;box-shadow:0 0 12px #4ADE80}

.stage{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#050806}
.bg{position:absolute;inset:0;background:radial-gradient(1400px 800px at 50% 118%,rgba(74,222,128,.13),transparent 70%),radial-gradient(1000px 600px at 50% -12%,rgba(126,242,216,.07),transparent 70%),linear-gradient(180deg,#09120E,#050806)}
.leak{position:absolute;border-radius:50%;filter:blur(90px);mix-blend-mode:screen;animation:var(--k) ${DURATION}s linear 0s both}
@keyframes leakA{0%{transform:translate(-200px,-120px)}25%{transform:translate(900px,40px)}50%{transform:translate(1300px,520px)}75%{transform:translate(300px,640px)}100%{transform:translate(700px,-80px)}}
@keyframes leakB{0%{transform:translate(1500px,700px)}30%{transform:translate(200px,500px)}60%{transform:translate(1000px,-100px)}100%{transform:translate(1400px,300px)}}
.beam{position:absolute;left:960px;top:-200px;width:2400px;height:1600px;transform-origin:50% 0;background:conic-gradient(from 180deg at 50% 0,transparent 168deg,rgba(182,255,210,.07) 176deg,rgba(182,255,210,.12) 180deg,rgba(182,255,210,.07) 184deg,transparent 192deg);margin-left:-1200px;animation:beam ${DURATION}s ease-in-out 0s both;mix-blend-mode:screen}
@keyframes beam{0%{transform:rotate(-14deg);opacity:0}10%{opacity:1}50%{transform:rotate(10deg)}100%{transform:rotate(-6deg);opacity:.8}}
.grain{position:absolute;inset:-80px;background-image:url("${grain}");opacity:.075;mix-blend-mode:overlay;animation:grain .5s steps(5) 0s infinite}
@keyframes grain{0%{transform:translate(0,0)}20%{transform:translate(-23px,17px)}40%{transform:translate(31px,-12px)}60%{transform:translate(-14px,-29px)}80%{transform:translate(19px,26px)}100%{transform:translate(0,0)}}
.vignette{position:absolute;inset:0;background:radial-gradient(ellipse 75% 70% at 50% 46%,transparent 55%,rgba(0,0,0,.62));pointer-events:none}
.c3d{position:absolute;inset:0;animation:dof ${DURATION}s linear 0s both}
.c3d canvas{position:absolute;inset:0;display:block;width:${W}px;height:${H}px}
.c3d canvas.glow{filter:blur(22px) brightness(.9) saturate(1.5);mix-blend-mode:screen}
${dof}
.scn{position:absolute;inset:0;opacity:0;animation:scn var(--d) linear var(--s) both}
.scn.last{animation-name:scnLast}
@keyframes scn{0%{opacity:0;filter:blur(16px);transform:scale(1.045)}8%{opacity:1;filter:none;transform:none}93%{opacity:1;filter:none;transform:none}100%{opacity:0;filter:blur(12px);transform:scale(.98)}}
@keyframes scnLast{0%{opacity:0;filter:blur(16px);transform:scale(1.045)}6%{opacity:1;filter:none;transform:none}100%{opacity:1;filter:none;transform:none}}
.wipe{position:absolute;top:-100px;left:0;width:520px;height:1280px;background:linear-gradient(90deg,transparent,rgba(182,255,210,.10) 40%,rgba(230,255,240,.22) 50%,rgba(182,255,210,.10) 60%,transparent);transform:translateX(-700px) skewX(-18deg);mix-blend-mode:screen;animation:wipe .75s cubic-bezier(.45,0,.2,1) var(--t) both;pointer-events:none}
@keyframes wipe{from{transform:translateX(-700px) skewX(-18deg)}to{transform:translateX(2300px) skewX(-18deg)}}
.center{position:absolute;left:0;right:0;text-align:center}
.wm{display:inline-block;overflow:hidden;vertical-align:bottom;padding:0 .02em .1em;margin-bottom:-.1em}
.wi{display:inline-block;animation:wordIn 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
@keyframes wordIn{from{transform:translateY(108%) rotate(4deg);filter:blur(12px);opacity:0}to{transform:none;filter:none;opacity:1}}
.metal{background-image:linear-gradient(100deg,transparent 0 38%,rgba(255,255,255,.95) 50%,transparent 62% 100%),linear-gradient(180deg,#FFFFFF 0%,#E3F8EC 50%,#9CC6AF 100%);background-size:300% 100%,100% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;color:transparent;animation:wordIn 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both,sheen 1.8s cubic-bezier(.45,0,.2,1) calc(var(--s) + var(--o) + .9s) both}
.glow{background-image:linear-gradient(100deg,transparent 0 38%,rgba(255,255,255,.9) 50%,transparent 62% 100%),linear-gradient(100deg,#C9FFE0,#4ADE80 45%,#D9F99D);background-size:300% 100%,100% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;color:transparent;animation:wordIn 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both,sheen 1.8s cubic-bezier(.45,0,.2,1) calc(var(--s) + var(--o) + .9s) both}
@keyframes sheen{from{background-position:120% 0,0 0}to{background-position:-20% 0,0 0}}
.hero{font:600 132px/1 'Inter Display',Inter;letter-spacing:-.05em;margin:0}
.big{font:600 156px/1 'Inter Display',Inter;letter-spacing:-.055em;margin:0}
.h2{font:600 78px/1.02 'Inter Display',Inter;letter-spacing:-.045em;margin:0;color:#F2FFF7}
.h3{font:600 86px/1.04 'Inter Display',Inter;letter-spacing:-.045em;margin:0;color:#F2FFF7}
.lede{font:400 31px/1.45 Inter;color:#A9BDB3;margin:0}
.body{font:400 29px/1.5 Inter;color:#A9BDB3;margin:28px 0 0;max-width:640px}
.in{animation:rise .9s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o,0s)) both}
@keyframes rise{from{opacity:0;transform:translateY(26px);filter:blur(8px)}to{opacity:1;transform:none;filter:none}}
.pill{display:inline-flex;align-items:center;gap:12px;font:500 24px Inter;color:#C9E8D6;border:1px solid rgba(134,239,172,.24);background:rgba(74,222,128,.07);padding:10px 22px;border-radius:999px}
.pill i{width:11px;height:11px;border-radius:50%;background:#4ADE80;box-shadow:0 0 14px #4ADE80;animation:pulse 1.2s ease-in-out 0s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.75)}50%{box-shadow:0 0 0 11px rgba(74,222,128,0)}}
.uline{position:absolute;left:560px;width:800px;height:3px;border-radius:3px;background:linear-gradient(90deg,transparent,#4ADE80,#D9F99D,transparent);box-shadow:0 0 22px rgba(74,222,128,.7);transform-origin:50% 50%;animation:uline 1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
@keyframes uline{from{transform:scaleX(0);opacity:0}to{transform:scaleX(1);opacity:1}}
.mk{position:absolute;transform-origin:0 0}
.hf{position:absolute;inset:0;filter:drop-shadow(0 24px 50px rgba(74,222,128,.45)) drop-shadow(0 0 24px rgba(74,222,128,.25))}
.sheen2{position:absolute;inset:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;background:linear-gradient(100deg,transparent 35%,rgba(255,255,255,.85) 50%,transparent 65%);background-size:300% 100%;mix-blend-mode:screen}
.flash{position:absolute;left:560px;top:140px;width:800px;height:800px;border-radius:50%;background:radial-gradient(closest-side,rgba(240,255,246,.95),rgba(134,239,172,.45) 35%,transparent 70%);mix-blend-mode:screen}
.streak{position:absolute;left:0;right:0;top:536px;height:8px;border-radius:8px;background:linear-gradient(90deg,transparent,rgba(126,242,216,.0) 10%,rgba(200,255,226,.95) 50%,rgba(126,242,216,0) 90%,transparent);filter:blur(2px);box-shadow:0 0 40px 10px rgba(74,222,128,.35);mix-blend-mode:screen}
.shock{position:absolute;left:960px;top:540px;width:520px;height:520px;border-radius:50%;border:2px solid rgba(182,255,210,.8);box-shadow:0 0 40px rgba(74,222,128,.5),inset 0 0 40px rgba(74,222,128,.3)}
.lk{position:absolute}
.left{position:absolute;left:120px;top:270px;width:680px}
.stepchip{display:inline-flex;align-items:center;gap:14px;font:500 23px Inter;color:#C9E8D6;margin-bottom:30px}
.stepchip b{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font:700 21px 'Inter Display',Inter;color:#06210F;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8);box-shadow:inset 0 0 0 2px rgba(255,255,255,.45),0 0 28px -4px rgba(74,222,128,.7)}
.tilt{position:absolute;transform-origin:50% 50%;animation:tilt var(--d) cubic-bezier(.2,.7,.2,1) calc(var(--s) + var(--o)) both}
@keyframes tilt{from{opacity:0;transform:perspective(2600px) translate3d(90px,30px,-160px) rotateY(-24deg) rotateX(8deg)}12%{opacity:1}to{opacity:1;transform:perspective(2600px) translate3d(0,0,0) rotateY(-9deg) rotateX(3deg)}}
.tilt.flat{animation-name:tiltFlat}
@keyframes tiltFlat{from{opacity:0;transform:perspective(2600px) translate3d(60px,30px,-120px) rotateY(-16deg) rotateX(6deg)}10%{opacity:1}to{opacity:1;transform:perspective(2600px) translate3d(0,0,0) rotateY(-4deg) rotateX(1.5deg)}}
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
.vp>img,.crop>img{position:absolute;left:0;top:0;display:block;width:2880px;height:1800px;max-width:none;transform-origin:0 0}
.sample{position:absolute;right:14px;bottom:12px;font:500 14px Inter;color:#C9E8D6;background:rgba(7,11,9,.8);border:1px solid rgba(134,239,172,.18);padding:5px 12px;border-radius:999px;z-index:3}
.cur{position:absolute;left:0;top:0;z-index:4;pointer-events:none}
.cur>div{position:absolute;left:0;top:0;filter:drop-shadow(0 6px 10px rgba(0,0,0,.6))}
.ripple{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:2px solid rgba(182,255,210,.95);background:rgba(74,222,128,.18);z-index:3}
@keyframes ripple{0%{opacity:0;transform:scale(.2)}20%{opacity:1}100%{opacity:0;transform:scale(1.4)}}
.tileglow{position:absolute;border-radius:16px;border:2px solid rgba(134,239,172,.95);box-shadow:0 0 0 6px rgba(74,222,128,.14),0 0 36px rgba(74,222,128,.55);z-index:2}
.hl{position:absolute;border-radius:14px;border:1.5px solid rgba(134,239,172,.9);background:rgba(74,222,128,.10);box-shadow:0 0 0 6px rgba(74,222,128,.10),0 0 40px rgba(74,222,128,.45);animation:hl 1.2s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both;z-index:2}
@keyframes hl{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
.badge{position:absolute;display:flex;align-items:center;gap:12px;font:600 23px Inter;color:#EAFBF1;background:rgba(14,24,19,.86);border:1px solid rgba(134,239,172,.3);padding:12px 22px 12px 12px;border-radius:999px;box-shadow:0 24px 60px -20px rgba(0,0,0,.9),0 0 40px -10px rgba(74,222,128,.5);animation:pop .8s cubic-bezier(.34,1.56,.64,1) calc(var(--s) + var(--o)) both}
.badge .ck,.tag .ck{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8)}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
.wal{position:absolute;left:1190px;top:520px;width:480px;padding:26px;border-radius:26px;background:linear-gradient(180deg,rgba(24,36,30,.96),rgba(12,19,16,.96));border:1px solid rgba(134,239,172,.28);box-shadow:0 50px 120px -30px rgba(0,0,0,.95),0 0 80px -30px rgba(74,222,128,.55);z-index:3}
.wh{display:flex;align-items:center;gap:14px;font:500 18px Inter;color:#97ACA2}
.wh b{display:block;font:600 21px Inter;color:#EAFBF1}
.wh small{font:500 16px Inter;color:#7E968A}
.wi2{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8)}
.wt{font:600 30px 'Inter Display',Inter;letter-spacing:-.02em;color:#F2FFF7;margin:22px 0 14px}
.wr{display:flex;justify-content:space-between;font:500 19px Inter;color:#97ACA2;padding:11px 0;border-top:1px solid rgba(255,255,255,.06)}
.wr b{color:#EAFBF1;font-weight:600}
.wb{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}
.wb span{display:grid;place-items:center;height:58px;border-radius:16px;font:600 21px Inter}
.wb .no{color:#C9E8D6;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
.wb .yes{color:#06210F;background:linear-gradient(100deg,#C9FFE0,#4ADE80 45%,#D9F99D);box-shadow:0 14px 40px -14px rgba(74,222,128,.9)}
.phone{position:absolute;width:320px;height:692px;border-radius:52px;padding:11px;background:linear-gradient(140deg,#2A3A32,#0C120F 40%,#1C2722);box-shadow:0 0 0 1px rgba(134,239,172,.28),0 70px 140px -30px rgba(0,0,0,.95),0 0 120px -40px rgba(74,222,128,.55)}
.phone .scr{position:relative;width:100%;height:100%;border-radius:42px;overflow:hidden;background:#0B110E}
.phone .scr img{position:absolute;left:0;top:0;width:298px;height:auto}
.phone .isl{position:absolute;left:50%;top:22px;width:96px;height:28px;margin-left:-48px;border-radius:20px;background:#000;z-index:2}
.phone .scr::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.10) 45%,transparent 58%);pointer-events:none}
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
  <div class="c3d"><canvas id="c3d" width="${W}" height="${H}"></canvas><canvas id="c3dGlow" class="glow" width="${W / 2}" height="${H / 2}"></canvas></div>

  ${sting}

  ${scene(
    "open",
    `<div class="center in" style="top:664px;${at(2.0)}"><span class="pill"><i></i>Live on Solana mainnet</span></div>
     <p class="center hero" style="top:742px">${words([["$USPAD", "glow"], ["is", "metal"], ["live.", "metal"]], 2.4, 0.14)}</p>
     <p class="center lede in" style="top:908px;${at(3.3)}">The token of uspad.fun, where every coin pays its holders in US stocks.</p>`,
  )}

  ${scene(
    "tour",
    `<p class="center big" style="top:390px">${words([["Inside", "metal"], ["uspad.fun", "glow"]], 0.1, 0.12)}</p>`,
  )}

  ${scene(
    "board",
    `${feature("The board", ["Every coin,", "live."], "Trending, new, top payers and about to graduate. Search any coin, or every coin that pays a stock.")}
     ${page({ k: "board", shot: "board", from: [0, 0, 1600], to: [60, 30, 1500], then: { shot: "grid", at: 2.8, from: [0, 15, 1560], to: [60, 60, 1400] } })}`,
  )}

  ${scene(
    "coin",
    `${feature("Coin pages", ["Chart it.", "Trade it."], "A live candlestick chart from 1 minute to 1 day, in price or market cap, and buying or selling with SOL right beside it.")}
     ${page({ k: "coin", shot: "coin", from: [0, 0, 1600], to: [40, 160, 1300] })}`,
  )}

  ${scene(
    "holders",
    `${feature("Holders", ["See who", "gets paid."], "Every holder's share and the stock each one has received, next to where every trade's fee goes.")}
     ${page({ k: "holders", shot: "holders", from: [0, 0, 1600], to: [0, 20, 1500] })}`,
  )}

  ${scene(
    "paid",
    `${STOCKS.map((s, i) => `<span class="sym" style="left:${960 + (i - 2.5) * 296}px;${at(1.05 + i * 0.16)}">${s.symbol}</span>`).join("")}
     <p class="center h3" style="top:560px">${words([["Holders get paid"]], 0.5, 0.1)}</p>
     <p class="center h3" style="top:656px">${words([["in", "metal"], ["US stocks,", "glow"], ["every hour.", "metal"]], 0.85, 0.1)}</p>
     <p class="center lede in" style="top:806px;${at(1.8)}">Hold $10 or more of a coin and its stock lands in your wallet,<br>on its own, every hour.</p>`,
  )}

  ${scene(
    "payouts",
    `${feature("Payouts", ["Every payout,", "on chain."], "A public receipt for every hourly round: what was paid, what it was worth, how many wallets, and its transaction.")}
     ${page({ k: "payouts", shot: "payouts", from: [0, 0, 1580], to: [40, 90, 1400] })}`,
  )}

  ${scene(
    "fees",
    `<p class="center lede in" style="top:196px;font-size:44px;color:#C9E8D6;${at(0.1)}">Every trade pays</p>
     <div class="center" style="top:270px"><p class="num">${roll(1, 0.3, 1)}<span>.</span>${roll(2, 0.4, 1)}${roll(5, 0.5, 1)}<span>%</span></p></div>
     <p class="center lede in" style="top:586px;font-size:44px;color:#C9E8D6;${at(0.9)}">on the bonding curve, split four ways.</p>
     <div class="splits center in" style="top:720px;${at(1.5)}">${[
       ["Holders, in stock", "0.50%", "#4ADE80"],
       ["Creator", "0.15%", "#5EEAD4"],
       ["uspad", "0.35%", "#D9F99D"],
       ["Raydium", "0.25%", "#3A4A42"],
     ]
       .map(([l, v, c]) => `<span class="fchip"><em style="background:${c}"></em>${l}<b>${v}</b></span>`)
       .join("")}</div>`,
  )}

  ${scene(
    "cta",
    `<p class="center hero" style="top:640px">${words([["Trade", "metal"], ["$USPAD.", "glow"]], 0.9, 0.16)}</p>
     <div class="center in" style="top:808px;${at(1.7)}"><span class="cta">uspad.fun ${arrow}</span></div>
     <p class="center socials in" style="top:930px;${at(2.2)}">@uspadfun · t.me/uspadfun</p>
     <p class="fine in" style="${at(2.6)}">Tickers can repeat on uspad: get $USPAD's address from @uspadfun. Tokenized stocks are issued by third parties and aren't available to US persons. Nothing here is financial advice.</p>`,
    "last",
  )}
  ${[S.open[0], S.board[0], S.paid[0], S.fees[0], S.cta[0]].map((t) => `<div class="wipe" style="--t:${t - 0.35}s"></div>`).join("")}
  <div class="grain"></div>
  <div class="vignette"></div>
</div>`;

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
          window.__coins = await window.coins3d.init(document.getElementById("c3d"), stocks, T, { glow: document.getElementById("c3dGlow") });
        },
        { stocks: STOCKS, T: { open: S.open, anyone: S.tour, paid: S.paid, cta: S.cta } },
      );
    },
    frameHook: "__coins",
    stills: stillsAt > 0 ? { dir: process.argv[stillsAt + 1], times: [1.2, 3.3, 8.5, 11, 13.5, 16.8, 20.5, 23, 26, 31.5, 36.5, 40.5, 46] } : undefined,
  });
  console.log(stillsAt > 0 ? "stills done" : "video done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
