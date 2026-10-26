// Renders presentation boards and PNG exports for the logo concepts.
// Usage: node boards.cjs <concepts dir> <boards out dir>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const SRC = process.argv[2];
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const concepts = JSON.parse(fs.readFileSync(path.join(SRC, "concepts.json"), "utf8"));
const svg = (k, f) => fs.readFileSync(path.join(SRC, k, f), "utf8");
const sized = (s, w, h) => s.replace(/<svg ([^>]*?)( width="[^"]*" height="[^"]*")?( role=)/, `<svg $1 width="${w}" height="${h ?? w}"$3`);
const small = (k) => (fs.existsSync(path.join(SRC, k, "mark-small.svg")) ? "mark-small.svg" : "mark.svg");
const lock = (s, w) => s.replace(/<svg /, `<svg width="${w}" `).replace(/ width="[^"]*"( width)/, "$1");

const css = `
*{box-sizing:border-box}
body{margin:0;background:#070B09;color:#EAFBF1;font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.board{padding:72px 80px 80px;background:radial-gradient(1200px 700px at 15% -10%,rgba(74,222,128,.10),transparent 60%),#070B09}
.eyebrow{font:500 15px Inter;letter-spacing:.02em;color:#86EFAC;margin:0 0 14px}
h1{font:600 56px/1.02 "Inter Display",Inter;letter-spacing:-.035em;margin:0 0 14px}
.lede{font:400 19px/1.5 Inter;color:#97ACA2;max-width:860px;margin:0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:48px}
.card{border:1px solid rgba(134,239,172,.12);border-radius:24px;background:linear-gradient(180deg,#0F1714,#0B110E);overflow:hidden}
.stage{height:360px;display:flex;align-items:center;justify-content:center;position:relative;background:radial-gradient(260px 220px at 50% 52%,rgba(74,222,128,.16),transparent 70%)}
.stage svg{filter:drop-shadow(0 18px 40px rgba(74,222,128,.22))}
.num{position:absolute;left:24px;top:20px;font:500 14px "JetBrains Mono",monospace;color:#64786E}
.meta{padding:22px 28px 26px;border-top:1px solid rgba(134,239,172,.08);display:flex;gap:24px;align-items:center;justify-content:space-between}
.name{font:600 26px "Inter Display",Inter;letter-spacing:-.02em;margin:0 0 6px}
.desc{font:400 15px/1.45 Inter;color:#97ACA2;margin:0;max-width:420px}
.mini{flex:none;opacity:.95}
.foot{margin-top:40px;display:flex;justify-content:space-between;color:#64786E;font:400 14px Inter}
.wm{display:flex;align-items:center;gap:28px;margin-top:36px}
/* detail */
.d-top{display:grid;grid-template-columns:620px 1fr;gap:24px;margin-top:40px}
.hero{height:620px;border-radius:28px;border:1px solid rgba(134,239,172,.12);display:flex;align-items:center;justify-content:center;background:radial-gradient(340px 300px at 50% 50%,rgba(74,222,128,.18),transparent 70%),linear-gradient(180deg,#0F1714,#0A0F0D)}
.hero svg{filter:drop-shadow(0 30px 60px rgba(74,222,128,.25))}
.stack{display:grid;grid-template-rows:1fr 1fr;gap:24px}
.tile{border-radius:28px;border:1px solid rgba(134,239,172,.12);display:flex;align-items:center;justify-content:center;position:relative}
.tile.dark{background:#0A0F0D}
.tile.light{background:#F4FBF6;border-color:#DDEFE3}
.tag{position:absolute;left:22px;top:18px;font:500 13px Inter;color:#64786E}
.light .tag{color:#5B7065}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;margin-top:24px}
.row .tile{height:260px}
.sizes{display:flex;align-items:flex-end;gap:22px}
.avatar{width:150px;height:150px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 1px rgba(134,239,172,.25)}
.avatar svg{width:150px;height:150px;display:block}
.icon svg{border-radius:0;filter:drop-shadow(0 16px 30px rgba(0,0,0,.5))}
`;

function overview() {
  const cards = concepts
    .map(
      (c, i) => `<div class="card"><div class="stage"><span class="num">0${i + 1}</span>${sized(svg(c.key, "mark.svg"), 250)}</div>
      <div class="meta"><div><p class="name">${c.label}</p><p class="desc">${c.desc}</p></div><div class="mini">${lock(svg(c.key, "lockup-dark.svg"), 230)}</div></div></div>`,
    )
    .join("");
  return `<div class="board"><p class="eyebrow">Divvy · konsep logo</p><h1>Enam arah logo premium</h1>
  <p class="lede">Semua memakai warna foil dan hijau dari prototype, dengan wordmark "divvy" yang digambar khusus (bukan font), jadi bisa dipakai tanpa lisensi font. Titik huruf i adalah koin.</p>
  <div class="grid">${cards}</div>
  <div class="wm">${lock(fs.readFileSync(path.join(SRC, "wordmark-dark.svg"), "utf8"), 360)}<span style="color:#64786E;font:400 15px Inter">Wordmark khusus: geometris, huruf v lancip, titik i berupa koin foil.</span></div>
  <div class="foot"><span>Konsep untuk dipilih. Logo di situs belum diganti.</span><span>brand/concepts/</span></div></div>`;
}

function detail(c, i) {
  const k = c.key;
  return `<div class="board"><p class="eyebrow">Divvy · konsep 0${i + 1}</p><h1>${c.label}</h1><p class="lede">${c.desc}</p>
  <div class="d-top"><div class="hero">${sized(svg(k, "mark.svg"), 440)}</div>
  <div class="stack"><div class="tile dark"><span class="tag">Di latar gelap</span>${lock(svg(k, "lockup-dark.svg"), 560)}</div>
  <div class="tile light"><span class="tag">Di latar terang</span>${lock(svg(k, "lockup-light.svg"), 560)}</div></div></div>
  <div class="row">
    <div class="tile dark icon"><span class="tag">Ikon aplikasi</span>${sized(svg(k, "app-icon.svg"), 170)}</div>
    <div class="tile dark"><span class="tag">Avatar token (X, Telegram, DEX)</span><div class="avatar">${svg(k, "app-icon.svg").replace(/width="512" height="512"/, 'width="150" height="150"')}</div></div>
    <div class="tile dark"><span class="tag">Ukuran kecil: 64, 32, 16 px${small(k) === "mark-small.svg" ? " (versi ringkas)" : ""}</span><div class="sizes">${sized(svg(k, "mark.svg"), 64)}${sized(svg(k, small(k)), 32)}${sized(svg(k, small(k)), 16)}</div></div>
    <div class="tile light"><span class="tag">Satu warna</span><div class="sizes" style="gap:30px">${sized(svg(k, "mark-ink.svg"), 110)}<div style="background:#0A0F0D;border-radius:18px;padding:14px;line-height:0">${sized(svg(k, "mark-mono.svg"), 82)}</div></div></div>
  </div>
  <div class="foot"><span>SVG dan PNG: brand/concepts/${k}/</span><span>Wordmark digambar khusus, tidak butuh font</span></div></div>`;
}

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const shot = async (html, file) => {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style>${html}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  };
  await shot(overview(), "00-overview.png");
  for (const [i, c] of concepts.entries()) await shot(detail(c, i), `0${i + 1}-${c.key}.png`);

  // Transparent PNG exports next to each concept's SVGs.
  const exp = await b.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 });
  const png = async (markup, file, w, h) => {
    await exp.setViewportSize({ width: w, height: h });
    await exp.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`);
    await exp.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  };
  for (const c of concepts) {
    const d = path.join(SRC, c.key);
    await png(sized(svg(c.key, "mark.svg"), 512), path.join(d, "mark-512.png"), 512, 512);
    await png(sized(svg(c.key, "app-icon.svg"), 512), path.join(d, "app-icon-512.png"), 512, 512);
    for (const v of ["dark", "light"]) {
      const s = svg(c.key, `lockup-${v}.svg`);
      const [, vw, vh] = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      const w = 1200, h = Math.round((w * vh) / vw);
      await png(lock(s, w), path.join(d, `lockup-${v}-1200.png`), w, h);
    }
  }
  await b.close();
})();
