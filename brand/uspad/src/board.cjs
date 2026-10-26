// Renders the uspad.fun brand board and PNG exports.
// Usage (repo root): node brand/uspad/src/board.cjs brand/uspad
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const DIR = process.argv[2];
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const w = (s, width) => s.replace(/ width="[^"]*" height="[^"]*"/, "").replace("<svg ", `<svg width="${width}" `);

const css = `*{box-sizing:border-box}body{margin:0;background:#070B09;color:#EAFBF1;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.board{padding:72px 80px 80px;background:radial-gradient(1200px 700px at 15% -10%,rgba(74,222,128,.10),transparent 60%),#070B09}
.eyebrow{font:500 15px Inter;color:#86EFAC;margin:0 0 14px}h1{font:600 56px/1.02 "Inter Display",Inter;letter-spacing:-.035em;margin:0 0 14px}
.lede{font:400 19px/1.5 Inter;color:#97ACA2;max-width:900px;margin:0}
.top{display:grid;grid-template-columns:560px 1fr;gap:24px;margin-top:40px}
.hero{height:600px;border-radius:28px;border:1px solid rgba(134,239,172,.12);display:flex;align-items:center;justify-content:center;background:radial-gradient(320px 280px at 50% 50%,rgba(74,222,128,.18),transparent 70%),linear-gradient(180deg,#0F1714,#0A0F0D)}
.hero svg{filter:drop-shadow(0 30px 60px rgba(74,222,128,.25))}
.stack{display:grid;grid-template-rows:repeat(3,1fr);gap:24px}.stack .tile{padding-top:22px}
.tile{border-radius:28px;border:1px solid rgba(134,239,172,.12);display:flex;align-items:center;justify-content:center;position:relative}
.dark{background:#0A0F0D}.light{background:#F4FBF6;border-color:#DDEFE3}
.tag{position:absolute;left:22px;top:16px;font:500 13px Inter;color:#64786E}.light .tag{color:#5B7065}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:24px}.row .tile{height:250px}
.sizes{display:flex;align-items:flex-end;gap:22px}
.avatar{width:150px;height:150px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 1px rgba(134,239,172,.25)}.avatar svg{display:block}
.tagline{margin-top:24px;border-radius:28px;border:1px solid rgba(134,239,172,.12);background:linear-gradient(180deg,#0F1714,#0B110E);padding:40px 48px;display:flex;justify-content:space-between;align-items:center;gap:40px}
.tl{font:600 44px/1.05 "Inter Display";letter-spacing:-.035em;margin:0}
.glow{background:linear-gradient(100deg,#B6FFD2,#4ADE80 45%,#D9F99D);-webkit-background-clip:text;background-clip:text;color:transparent}
.note{font:400 16px/1.5 Inter;color:#97ACA2;max-width:520px;margin:0}
.foot{margin-top:36px;display:flex;justify-content:space-between;color:#64786E;font:400 14px Inter}`;

const html = `<div class="board"><p class="eyebrow">uspad.fun · identitas</p><h1>uspad.fun</h1>
<p class="lede">"us" artinya kita, sekaligus US: setiap koin membayar holder-nya dengan saham Amerika. Logo Koin belah: satu koin dibelah, bagiannya dibagikan.</p>
<div class="top"><div class="hero">${w(read("mark.svg"), 400)}</div>
<div class="stack"><div class="tile dark"><span class="tag">Logo utama, latar gelap</span>${w(read("lockup-dark.svg"), 400)}</div>
<div class="tile light"><span class="tag">Dengan domain, latar terang</span>${w(read("lockup-fun-light.svg"), 520)}</div>
<div class="tile dark"><span class="tag">Wordmark saja</span>${w(read("wordmark-dark.svg"), 440)}</div></div></div>
<div class="row">
<div class="tile dark"><span class="tag">Ikon aplikasi</span>${w(read("app-icon.svg"), 170)}</div>
<div class="tile dark"><span class="tag">Avatar token (X, Telegram, DEX)</span><div class="avatar">${w(read("app-icon.svg"), 150)}</div></div>
<div class="tile dark"><span class="tag">64, 32, 16 px</span><div class="sizes">${w(read("mark.svg"), 64)}${w(read("mark.svg"), 32)}${w(read("mark.svg"), 16)}</div></div>
<div class="tile light"><span class="tag">Satu warna</span><div class="sizes" style="gap:30px">${w(read("mark-ink.svg"), 100)}<div style="background:#0A0F0D;border-radius:18px;padding:14px;line-height:0">${w(read("mark-mono.svg"), 76)}</div></div></div></div>
<div class="tagline"><p class="tl">Memecoins that pay <span class="glow">us.</span><br>In <span class="glow">US stocks.</span></p>
<p class="note">Usulan tagline yang memakai dua arti "us". Huruf tagline di board ini memakai Inter; wordmark "uspad.fun" digambar khusus dan tidak butuh font.</p></div>
<div class="foot"><span>SVG dan PNG: brand/uspad/</span><span>Situs belum diganti sampai nama final</span></div></div>`;

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(DIR, "board.png"), fullPage: true });

  const exp = await b.newPage();
  const png = async (svgText, file, width) => {
    const [, vw, vh] = svgText.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const height = Math.round((width * vh) / vw);
    await exp.setViewportSize({ width, height });
    await exp.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${w(svgText, width)}`);
    await exp.screenshot({ path: path.join(DIR, file), omitBackground: true, clip: { x: 0, y: 0, width, height } });
  };
  await png(read("mark.svg"), "mark-512.png", 512);
  await png(read("app-icon.svg"), "app-icon-512.png", 512);
  await png(read("mark.svg"), "favicon-32.png", 32);
  for (const f of ["lockup-dark", "lockup-light", "lockup-fun-dark", "lockup-fun-light"]) await png(read(`${f}.svg`), `${f}-1200.png`, 1200);
  await b.close();
})();
