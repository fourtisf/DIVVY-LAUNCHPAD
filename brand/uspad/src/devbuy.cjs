// "Dev buys first" announcement for X: the dev buy rides inside the coin's create, so it's the coin's
// first trade (owner decision 2026-10-28). 16:9 for X posts (1600 x 900) and 4:5 for mobile feeds and
// Telegram (1080 x 1350), at 2x. The coin shown is an example, $YOURCOIN, not a real one.
// Usage (repo root): node brand/uspad/src/devbuy.cjs brand/uspad
// Figures are the site's: 0.01 to 80 SOL (DEV_BUY_MIN/MAX_LAMPORTS), 1 SOL ≈ 3.4% (devBuyEstimate).
const fs = require("fs");
const path = require("path");
const { sized, stockLogo, guilloche, render } = require("./lib.cjs");

const DIR = process.argv[2];
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");

const svg = (d, size = 18, w = 2.4) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const check = svg(`<path d="M5 12l5 5L20 7"/>`, 18, 2.8);
const lock = svg(`<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`, 17);
const bolt = svg(`<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`, 16, 2.2);
const shield = svg(`<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>`, 16, 2.2);
const eye = svg(`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`, 16, 2.2);

// The example coin: a plain uspad-green coin with its initials.
const coin = (size) =>
  `<span class="coin" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px">YC</span>`;

// One transaction, in order: the create, then the dev buy. Everyone else comes after it lands.
const tx = (w) => `<div class="tx" style="width:${w}px">
  <div class="tx-h"><span>One transaction</span><span class="blk">${bolt}Private bundle</span></div>
  <div class="row"><span class="n">1</span>${coin(44)}<div class="what"><b>Create $YOURCOIN</b><small>The coin is born</small></div><span class="ok">${check}</span></div>
  <div class="row hot"><span class="n">2</span><img class="sol" src="${stockLogo(DIR, "SOL")}" alt=""><div class="what"><b>Dev buy · 1 SOL</b><small>About 3.4% of the supply</small></div><span class="first">First trade</span></div>
  <div class="after">${lock}<span>Everyone else can only buy once this lands</span></div>
</div>`;

// The coin's page as everyone sees it: the dev buy next to the private bundle tag.
const coinPage = (w) => `<div class="cp" style="width:${w}px">
  <small>On the coin's page</small>
  <div class="cp-row">${coin(52)}<div><b>Your Coin <span>$YOURCOIN</span></b>
    <div class="cp-tags"><span>${shield}Private bundle launch</span><span class="on">${eye}Dev bought 3.4%</span></div></div></div>
</div>`;

const picks = `<div class="picks">${["0.1", "0.2", "0.5", "1"].map((q) => `<span${q === "1" ? ' class="on"' : ""}>${q} SOL</span>`).join("")}<span>Max</span></div>`;
const tags = (dir = "row") =>
  `<div class="tags" style="flex-direction:${dir}"><span>${shield}No snipers: the create is a private bundle</span><span>${eye}Shown on every coin: "Dev bought 3.4%"</span></div>`;

const css = `
.coin{flex:none;display:grid;place-items:center;border-radius:50%;font-family:'Inter Display',Inter;font-weight:700;color:#06210F;letter-spacing:-.02em;background:radial-gradient(circle at 32% 28%,#E4FFA6,#86EFAC 45%,#2BB673);box-shadow:inset 0 0 0 2px rgba(255,255,255,.45),0 10px 24px -8px rgba(74,222,128,.6)}
.tx{position:relative;padding:26px;border-radius:28px;border:1px solid rgba(134,239,172,.2);background:linear-gradient(180deg,rgba(20,32,25,.96),rgba(10,16,13,.96));box-shadow:0 40px 90px -30px rgba(0,0,0,.85),0 0 0 1px rgba(74,222,128,.05)}
.tx-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;font:600 15px Inter;color:#7E968A}
.tx-h .blk{display:inline-flex;align-items:center;gap:7px;color:#C9E8D6;border:1px solid rgba(134,239,172,.22);background:rgba(74,222,128,.07);padding:6px 12px;border-radius:999px}
.tx-h .blk svg{color:#4ADE80}
.row{display:flex;align-items:center;gap:16px;padding:18px 18px;border-radius:20px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02)}
.row + .row{margin-top:12px}
.row .n{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:600 15px 'Inter Display',Inter;color:#9FB7AB;border:1px solid rgba(255,255,255,.12)}
.row .what{flex:1;min-width:0}
.row b{display:block;font:600 22px 'Inter Display',Inter;letter-spacing:-.02em}
.row small{display:block;margin-top:4px;font:400 15px Inter;color:#8FA79B}
.row .ok{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#4ADE80;background:rgba(74,222,128,.12)}
.row .sol{flex:none;width:44px;height:44px;border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.18)}
.cp{padding:22px 24px;border-radius:24px;border:1px solid rgba(255,255,255,.07);background:rgba(10,16,13,.82)}
.cp small{display:block;margin-bottom:14px;font:600 14px Inter;color:#7E968A}
.cp-row{display:flex;align-items:center;gap:16px}
.cp b{font:600 24px 'Inter Display',Inter;letter-spacing:-.02em}
.cp b span{margin-left:6px;font:500 16px Inter;color:#7E968A;letter-spacing:0}
.cp-tags{display:flex;gap:8px;margin-top:10px}
.cp-tags span{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.1);font:500 13.5px Inter;color:#97ACA2}
.cp-tags span svg{color:#7E968A}
.cp-tags span.on{color:#B6FFD2;border-color:rgba(134,239,172,.5);background:rgba(74,222,128,.1);box-shadow:0 0 22px -6px rgba(74,222,128,.7)}
.cp-tags span.on svg{color:#4ADE80}
.cta{display:flex;align-items:center;justify-content:space-between;padding:26px 30px;border-radius:24px;border:1px solid rgba(134,239,172,.22);background:linear-gradient(100deg,rgba(74,222,128,.12),rgba(94,234,212,.06))}
.cta span{font:600 34px 'Inter Display',Inter;letter-spacing:-.03em}
.row.hot{border-color:rgba(74,222,128,.55);background:linear-gradient(100deg,rgba(74,222,128,.16),rgba(94,234,212,.06));box-shadow:0 0 0 4px rgba(74,222,128,.08),0 20px 50px -20px rgba(74,222,128,.55)}
.row.hot .n{color:#06210F;border:0;background:linear-gradient(100deg,#C9FFE0,#86EFAC 30%,#E4FFA6 60%,#7EF2D8)}
.row .first{flex:none;font:600 14px Inter;color:#06210F;background:#4ADE80;padding:7px 13px;border-radius:999px;box-shadow:0 0 22px -4px rgba(74,222,128,.8)}
.after{display:flex;align-items:center;gap:10px;margin-top:16px;padding:14px 18px;border-radius:16px;border:1px dashed rgba(255,255,255,.12);font:500 15px Inter;color:#7E968A}
.after svg{color:#7E968A}
.picks{display:flex;gap:8px}
.picks span{display:grid;place-items:center;height:38px;padding:0 16px;border-radius:11px;border:1px solid rgba(255,255,255,.1);font:500 15px Inter;color:#9FB7AB}
.picks span.on{color:#B6FFD2;border-color:rgba(134,239,172,.45);background:rgba(74,222,128,.08)}
.tags{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
.tags span{display:inline-flex;align-items:center;gap:9px;font:500 16px Inter;color:#C9E8D6;padding:9px 15px;border-radius:999px;border:1px solid rgba(134,239,172,.16);background:rgba(255,255,255,.02)}
.tags svg{color:#4ADE80}
.lede{margin:0;font:400 21px/1.5 Inter;color:#A3B8AD}
.lede b{color:#EAFBF1;font-weight:600}
.foot{display:flex;justify-content:space-between;font:500 16px Inter;color:#6E857A}`;

const bg = (glows) => `background:${glows},linear-gradient(180deg,#0B130F,#070B09)`;

// 16:9: the claim on the left, the transaction on the right.
const wide = `<div style="width:1600px;height:900px;position:relative;overflow:hidden;${bg("radial-gradient(620px 460px at 1180px 430px,rgba(74,222,128,.17),transparent 70%),radial-gradient(800px 420px at 160px 980px,rgba(94,234,212,.08),transparent 70%)")}">
  ${guilloche(1600, 900, 40, 13, 0.05)}
  <div style="position:absolute;right:86px;top:56px;filter:drop-shadow(0 24px 44px rgba(74,222,128,.35))">${sized(read("mark.svg"), 120)}</div>
  <div style="position:absolute;left:86px;top:66px">${sized(read("lockup-dark.svg"), 150)}</div>
  <div style="position:absolute;left:86px;top:178px;width:700px">
    <span class="pill"><i></i>New on uspad</span>
    <p style="margin:24px 0 0;font:600 104px/0.98 'Inter Display',Inter;letter-spacing:-.05em">The dev buys <span class="glow">first.</span></p>
    <p class="lede" style="margin-top:28px">Add a dev buy to your launch. It goes <b>inside the create</b>, in the same transaction, so it's your coin's <b>first trade</b>, before anyone else can buy.</p>
    <div style="margin-top:30px">${picks}</div>
    <div style="margin-top:26px">${tags("column")}</div>
  </div>
  <div style="position:absolute;left:880px;top:218px">${tx(634)}</div>
  <div style="position:absolute;left:880px;top:600px">${coinPage(634)}</div>
  <div class="foot" style="position:absolute;left:86px;right:86px;bottom:36px"><span>uspad.fun · @uspadfun · t.me/uspadfun</span><span>Optional, from 0.01 to 80 SOL</span></div>
</div>`;

// 4:5: stacked for phones.
const tall = `<div style="width:1080px;height:1350px;position:relative;overflow:hidden;${bg("radial-gradient(640px 500px at 540px 860px,rgba(74,222,128,.16),transparent 70%),radial-gradient(700px 420px at 900px 40px,rgba(94,234,212,.08),transparent 70%)")}">
  ${guilloche(1080, 1350, 54, 12, 0.05)}
  <div style="position:absolute;right:72px;top:58px;filter:drop-shadow(0 24px 44px rgba(74,222,128,.35))">${sized(read("mark.svg"), 110)}</div>
  <div style="position:absolute;left:72px;top:70px">${sized(read("lockup-dark.svg"), 140)}</div>
  <div style="position:absolute;left:72px;right:72px;top:190px">
    <span class="pill"><i></i>New on uspad</span>
    <p style="margin:22px 0 0;font:600 96px/0.98 'Inter Display',Inter;letter-spacing:-.05em">The dev buys <span class="glow">first.</span></p>
    <p class="lede" style="margin-top:24px">Add a dev buy to your launch. It goes <b>inside the create</b>, in the same transaction, so it's your coin's <b>first trade</b>, before anyone else can buy.</p>
  </div>
  <div style="position:absolute;left:72px;top:478px">${tx(936)}</div>
  <div style="position:absolute;left:72px;top:862px">${coinPage(936)}</div>
  <div style="position:absolute;left:72px;top:1034px">${picks}</div>
  <div style="position:absolute;left:72px;right:72px;top:1096px">${tags()}</div>
  <div class="cta" style="position:absolute;left:72px;right:72px;top:1160px;padding:20px 28px"><span>Launch yours at <span class="glow">uspad.fun</span></span>${coin(48)}</div>
  <div class="foot" style="position:absolute;left:72px;right:72px;bottom:36px"><span>uspad.fun · @uspadfun</span><span>Optional, 0.01 to 80 SOL</span></div>
</div>`;

(async () => {
  await render(DIR, "dev-buys-first-3200x1800.png", 1600, 900, css, wide);
  await render(DIR, "dev-buys-first-2160x2700.png", 1080, 1350, css, tall);
  console.log("done");
})();
