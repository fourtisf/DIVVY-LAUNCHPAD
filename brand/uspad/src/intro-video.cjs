// uspad intro video for X (16:9, 1920 x 1080, 30 fps, H.264), riding the #BOYCOTTPUMPFUN timeline.
// Pump.fun appears only as that hashtag: no logo of theirs and no claim about them. Every uspad fact
// matches the site's How it works page and docs/VERIFIED.md.
// Usage (repo root): node brand/uspad/src/intro-video.cjs brand/uspad
// Frames are seeked with the Web Animations API, so every frame is exact whatever the render speed.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");
const { sized, stockLogo, guilloche, baseCss } = require("./lib.cjs");

const DIR = process.argv[2];
const OUT = path.join(DIR, "social", "uspad-intro-1920x1080.mp4");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const W = 1920;
const H = 1080;
const FPS = 30;

// Scenes: [start, length] in seconds.
const S = { tag: [0, 4.4], nothing: [4.4, 4.4], meet: [8.8, 5], fee: [13.8, 5.6], hourly: [19.4, 5.4], fair: [24.8, 4.8], cta: [29.6, 4.4] };
const DURATION = S.cta[0] + S.cta[1];
const scene = (k, inner, cls = "") => `<section class="scene ${cls}" style="--s:${S[k][0]}s;--d:${S[k][1]}s">${inner}</section>`;
const at = (o) => `--o:${o}s`;

const tag = "#BOYCOTTPUMPFUN"
  .split("")
  .map((c, i) => `<span class="ch" style="${at(0.55 + i * 0.06)}">${c}</span>`)
  .join("");

// The six featured stocks around the mark, as on the site's hero.
const CX = 960;
const CY = 410;
const ORBIT = 250;
const chips = ["NVDAx", "SPYx", "TSLAx", "AAPLx", "QQQx", "MSTRx"]
  .map((s, i) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    return `<div class="chip pop" style="left:${CX + Math.cos(a) * ORBIT}px;top:${CY + Math.sin(a) * ORBIT}px;${at(0.7 + i * 0.12)}"><img src="${stockLogo(DIR, s)}" style="width:84px;height:84px"><span>${s}</span></div>`;
  })
  .join("");
const ring = (d, o, delay) => `<div class="ring grow" style="left:${CX}px;top:${CY}px;width:${d}px;height:${d}px;border:1px solid rgba(134,239,172,${o});${at(delay)}"></div>`;

// The 1% on the curve (fee split from the site): widths out of 1400 px.
const split = [
  ["0.50%", "holders", 700, "linear-gradient(100deg,#86EFAC,#4ADE80)"],
  ["0.15%", "creator", 210, "#2E7D52"],
  ["0.10%", "uspad", 140, "#D9F99D"],
  ["0.25%", "Raydium", 350, "#1B2621"],
];
let x = 0;
const bar = split
  .map(([pct, who, w, bg], i) => {
    const seg = `<div class="seg" style="left:${x}px;width:${w}px;background:${bg};${at(0.9 + i * 0.35)}"></div>
      <div class="segl in" style="left:${x}px;width:${w}px;${at(1.15 + i * 0.35)}"><b style="color:${i === 0 ? "#4ADE80" : "#EAFBF1"}">${pct}</b><span>${who}</span></div>`;
    x += w;
    return seg;
  })
  .join("");

const nvda = stockLogo(DIR, "NVDAx");
const rows = ["14:00", "15:00", "16:00"]
  .map((h, i) => `<div class="row in" style="${at(1.3 + i * 1.1)}"><img src="${nvda}"><div><b>NVDAx</b><span>${h} UTC round</span></div><em>Sent</em></div>`)
  .join("");

const icon = {
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
};
const cards = [
  ["shield", "No snipers", "Every coin is created in a private Jito bundle, so nobody buys in its first block."],
  ["ban", "No dev buy", "No team allocation either. The whole supply goes to the curve and the pool."],
  ["lock", "Locked forever", "At 85 SOL a coin graduates, and its liquidity is locked with Raydium Burn & Earn."],
]
  .map(
    ([i, t, d], k) =>
      `<div class="card in" style="${at(0.5 + k * 0.3)}"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon[i]}</svg><b>${t}</b><p>${d}</p></div>`,
  )
  .join("");

const css = `
.stage{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:linear-gradient(180deg,#0B130F,#070B09)}
.glowbg{position:absolute;width:1400px;height:1100px;left:260px;top:-10px;background:radial-gradient(closest-side,rgba(74,222,128,.20),transparent);animation:drift ${DURATION}s linear 0s both}
@keyframes drift{0%{transform:translate(-260px,-60px)}50%{transform:translate(160px,40px)}100%{transform:translate(-80px,-20px)}}
.scene{position:absolute;inset:0;opacity:0;animation:sc var(--d) linear var(--s) both}
.scene.last{animation-name:scLast}
@keyframes sc{0%{opacity:0}6%{opacity:1}94%{opacity:1}100%{opacity:0}}
@keyframes scLast{0%{opacity:0}10%{opacity:1}100%{opacity:1}}
.in{animation:rise .8s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o,0s)) both}
@keyframes rise{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
.pop{animation:pop .7s cubic-bezier(.34,1.56,.64,1) calc(var(--s) + var(--o,0s)) both}
@keyframes pop{from{opacity:0;transform:translate(-50%,-50%) scale(.3)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.grow{animation:grow 1.1s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o,0s)) both}
@keyframes grow{from{opacity:0;transform:translate(-50%,-50%) scale(.6)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.center{position:absolute;left:0;right:0;text-align:center}
.h1{font:700 104px/1.02 'Inter Display',Inter;letter-spacing:-.045em;margin:0}
.h2{font:600 76px/1.05 'Inter Display',Inter;letter-spacing:-.04em;margin:0}
.lede{font:400 34px/1.4 Inter;color:#A9BDB3;margin:0}
.pill{font-size:24px;padding:10px 22px;gap:12px}.pill i{width:10px;height:10px}
/* Letters not typed yet take no room, so the caret follows the last one. */
.ch{font-size:0;animation:ch .01s steps(1) calc(var(--s) + var(--o)) both}
@keyframes ch{to{font-size:150px}}
.caret{display:inline-block;width:8px;height:118px;background:#4ADE80;margin-left:10px;vertical-align:-14px;animation:blink 1s steps(2,jump-none) 0s infinite}
@keyframes blink{0%{opacity:1}100%{opacity:0}}
.zero{position:absolute;left:660px;top:470px;width:600px;padding:34px 40px;border-radius:28px;border:1px solid rgba(134,239,172,.14);background:linear-gradient(180deg,rgba(17,27,22,.92),rgba(11,17,14,.92));text-align:left}
.zero span{font:500 24px Inter;color:#7F978B}.zero b{display:block;font:600 96px/1.1 'Inter Display',Inter;letter-spacing:-.04em;color:#5B6E64;margin-top:6px}
.zero svg{position:absolute;right:40px;bottom:40px}
.chip{position:absolute;display:flex;flex-direction:column;align-items:center;gap:10px}
.chip img{border-radius:50%;display:block;box-shadow:0 0 0 2px rgba(255,255,255,.22),0 14px 34px -10px rgba(0,0,0,.8),0 0 26px -6px rgba(74,222,128,.45)}
.chip span{font:600 18px Inter;color:#C9E8D6;background:rgba(7,11,9,.72);border:1px solid rgba(134,239,172,.16);padding:4px 12px;border-radius:999px}
.seg{position:absolute;top:0;height:96px;transform-origin:left center;animation:seg .55s cubic-bezier(.16,1,.3,1) calc(var(--s) + var(--o)) both}
@keyframes seg{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.bar{position:absolute;left:260px;top:520px;width:1400px;height:96px;border-radius:22px;overflow:hidden;box-shadow:0 0 0 1px rgba(134,239,172,.16)}
.labels{position:absolute;left:260px;top:640px;width:1400px}
.segl{position:absolute;top:0;display:flex;flex-direction:column;gap:4px;padding-left:4px}
.segl b{font:700 34px 'Inter Display',Inter;letter-spacing:-.02em}.segl span{font:500 24px Inter;color:#97ACA2}
.clock{position:absolute;left:330px;top:330px}
.hand{transform-origin:170px 170px;animation:spin 1.5s linear calc(var(--s) + .6s) 3 both}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.wallet{position:absolute;left:820px;top:300px;width:780px;padding:34px 36px;border-radius:28px;border:1px solid rgba(134,239,172,.16);background:linear-gradient(180deg,rgba(17,27,22,.94),rgba(11,17,14,.94))}
.wallet h3{margin:0 0 22px;font:600 28px Inter;color:#C9E8D6;display:flex;justify-content:space-between}.wallet h3 small{font:500 20px Inter;color:#6E857A}
.row{display:flex;align-items:center;gap:20px;padding:18px 20px;border-radius:18px;background:rgba(74,222,128,.06);border:1px solid rgba(134,239,172,.12);margin-top:14px}
.row img{width:58px;height:58px;border-radius:50%}.row div{flex:1}.row b{display:block;font:600 28px Inter}.row span{font:400 21px Inter;color:#97ACA2}
.row em{font:600 21px Inter;font-style:normal;color:#06210F;background:#4ADE80;padding:6px 14px;border-radius:999px}
.cards{position:absolute;left:180px;right:180px;top:430px;display:flex;gap:36px}
.card{flex:1;padding:38px 36px;border-radius:28px;border:1px solid rgba(134,239,172,.14);background:linear-gradient(180deg,rgba(17,27,22,.92),rgba(11,17,14,.92))}
.card b{display:block;font:600 40px 'Inter Display',Inter;letter-spacing:-.02em;margin:22px 0 12px}.card p{margin:0;font:400 25px/1.45 Inter;color:#A9BDB3}
.fine{position:absolute;left:0;right:0;bottom:44px;text-align:center;font:400 19px Inter;color:#5F766B}`;

const html = `<div class="stage">
  <div class="glowbg"></div>
  ${guilloche(W, H, 44, 15, 0.05)}

  ${scene(
    "tag",
    `<div class="center in" style="top:300px;${at(0.15)}"><span class="pill"><i></i>All over the timeline right now</span></div>
     <p class="center h1" style="top:400px;font-size:150px">${tag}<span class="caret"></span></p>
     <p class="center lede in" style="top:640px;${at(2.0)}">Fair enough. Here's what a launchpad should do.</p>`,
  )}

  ${scene(
    "nothing",
    `<p class="center h2 in" style="top:210px;${at(0.1)}">Holding a memecoin<br>pays you nothing.</p>
     <div class="zero in" style="${at(0.6)}"><span>Paid to holders</span><b>$0.00</b>
       <svg width="200" height="70" viewBox="0 0 200 70"><path d="M0 60 L200 60" stroke="#3A4A42" stroke-width="4" stroke-linecap="round"/></svg></div>
     <p class="center h2 in" style="top:800px;${at(2.4)}"><span class="glow">Until now.</span></p>`,
  )}

  ${scene(
    "meet",
    `${ring(ORBIT * 2, 0.16, 0.2)}${ring(ORBIT * 2 + 170, 0.07, 0.35)}${ring(300, 0.12, 0.1)}
     <div class="pop" style="position:absolute;left:${CX}px;top:${CY}px;${at(0.15)};filter:drop-shadow(0 34px 60px rgba(74,222,128,.42)) drop-shadow(0 0 30px rgba(74,222,128,.2))">${sized(read("mark.svg"), 250)}</div>
     ${chips}
     <p class="center h2 in" style="top:770px;${at(1.6)}">Meet uspad. Memecoins that pay you in <span class="glow">US stocks.</span></p>
     <p class="center lede in" style="top:880px;${at(2.1)}">Launch on Solana. Holders earn NVDAx, SPYx, TSLAx and more.</p>`,
  )}

  ${scene(
    "fee",
    `<p class="center h2 in" style="top:220px;${at(0.1)}">Every trade pays 1%.</p>
     <p class="center lede in" style="top:330px;${at(0.4)}">Half of it goes to the coin's holders.</p>
     <div class="bar">${bar.replace(/<div class="segl[\s\S]*?<\/div>/g, "")}</div>
     <div class="labels">${[...bar.matchAll(/<div class="segl[\s\S]*?<\/div>/g)].map((m) => m[0]).join("")}</div>`,
  )}

  ${scene(
    "hourly",
    `<p class="center h2 in" style="top:120px;${at(0.1)}">Paid every hour, in real stock tokens.</p>
     <svg class="clock in" style="${at(0.3)}" width="340" height="340" viewBox="0 0 340 340">
       <circle cx="170" cy="170" r="150" fill="rgba(17,27,22,.9)" stroke="rgba(134,239,172,.25)" stroke-width="2"/>
       ${Array.from({ length: 12 }, (_, i) => `<line x1="170" y1="32" x2="170" y2="${i % 3 ? 44 : 54}" stroke="#4ADE80" stroke-opacity="${i % 3 ? 0.35 : 0.9}" stroke-width="4" stroke-linecap="round" transform="rotate(${i * 30} 170 170)"/>`).join("")}
       <g class="hand"><line x1="170" y1="170" x2="170" y2="58" stroke="#EAFBF1" stroke-width="7" stroke-linecap="round"/></g>
       <circle cx="170" cy="170" r="11" fill="#4ADE80"/>
     </svg>
     <div class="wallet in" style="${at(0.5)}"><h3>Your wallet <small>Example</small></h3>${rows}</div>
     <p class="center lede in" style="top:880px;${at(0.8)}">Hold $10 or more of a coin, and its stock lands in your wallet every hour.</p>`,
  )}

  ${scene(
    "fair",
    `<p class="center h2 in" style="top:220px;${at(0.1)}">Fair from the first block.</p>
     <div class="cards">${cards}</div>`,
  )}

  ${scene(
    "cta",
    `<div class="pop" style="position:absolute;left:960px;top:330px;${at(0.15)}">${sized(read("lockup-dark.svg"), 560)}</div>
     <p class="center h2 in" style="top:470px;${at(0.6)}">Memecoins that pay you in <span class="glow">US stocks.</span></p>
     <div class="center in" style="top:600px;${at(1.0)}"><span class="pill"><i></i>Launching soon on Solana</span></div>
     <p class="center in" style="top:700px;margin:0;font:600 64px 'Inter Display',Inter;letter-spacing:-.03em;${at(1.3)}"><span class="glow">uspad.fun</span> <span style="color:#6E857A">·</span> @uspadfun</p>
     <p class="fine in" style="${at(1.8)}">Tokenized stocks are issued by third parties and aren't available to US persons. Nothing here is financial advice.</p>`,
    "last",
  )}
</div>`;

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${baseCss}${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const seek = (ms) => page.evaluate((t) => document.getAnimations().forEach((a) => (a.currentTime = t)), ms);

  // --stills <dir>: one frame from the end of each scene, to check the layout before a full render.
  if (process.argv[3] === "--stills") {
    for (const [k, [s, d]] of Object.entries(S)) {
      await seek((s + d - 0.5) * 1000);
      await page.screenshot({ path: path.join(process.argv[4], `${k}.png`) });
    }
    await b.close();
    return;
  }

  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round(DURATION * FPS);
  for (let f = 0; f < frames; f++) {
    await seek((f / FPS) * 1000);
    const png = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % (FPS * 5) === 0) process.stdout.write(`${(f / FPS).toFixed(0)}s `);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));
  await b.close();
  console.log(`\n${OUT}`);
})();
