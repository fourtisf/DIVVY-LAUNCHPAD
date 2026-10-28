// Product shots for the "$USPAD is live" video, taken from the live site: the board, a search by stock,
// $USPAD's coin page with its chart and its holders, the payouts page, and the board on a phone. Every
// contract address is hidden (the hero's pill, the coin page's address and its "Check the address"
// panel): the video names the ticker only (owner request 2026-10-28).
// Usage (repo root; the coin by its mint, as tickers can repeat):
//   node brand/uspad/src/token-shots.cjs https://uspad.fun brand/uspad/social/token-shots <USPAD mint>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [BASE, OUT, COIN] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

// No contract address anywhere in the shots, nor Next's dev badge (a local run).
const hide = () =>
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "nextjs-portal,.ca-pill,#copyCa{display:none!important}";
    document.head.appendChild(s);
  });
const hidePanels = (page) =>
  page.evaluate(() => {
    for (const h of document.querySelectorAll("h3")) if (h.textContent?.trim() === "Check the address") h.closest(".panel").style.display = "none";
  });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(hide);
  const page = await ctx.newPage();
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 92 });
  const settle = (ms = 1200) => page.waitForLoadState("networkidle").then(() => page.waitForTimeout(ms));
  const scrollTo = (sel, gap) => page.evaluate(([s, g]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + window.scrollY - g), [sel, gap]);

  // The board: its hero, then the coins.
  await page.goto(`${BASE}/`);
  await settle(2500);
  await page.mouse.move(0, 0);
  await shot("board");
  await scrollTo("#grid", 260);
  await page.waitForTimeout(1200);
  await shot("grid");

  // A search by stock: every coin that pays NVDAx.
  await page.locator("#search").fill("NVDAx");
  await settle(1500);
  await scrollTo("#grid", 260);
  await page.waitForTimeout(1200);
  await shot("search");

  // A coin page: the candlestick chart and the trade box, then its holders.
  await page.goto(`${BASE}/coin/${COIN}`);
  await settle(2000);
  await page.getByRole("button", { name: "15m", exact: true }).click();
  await page.getByRole("button", { name: "Market cap", exact: true }).click();
  await page.waitForTimeout(1500);
  await scrollTo(".coin-grid", 150);
  await page.waitForTimeout(800);
  const plot = await page.locator(".cchart-plot").boundingBox();
  await page.mouse.move(plot.x + plot.width * 0.72, plot.y + plot.height * 0.35);
  await page.waitForTimeout(500);
  await hidePanels(page);
  await shot("coin");
  await page.getByRole("tab", { name: "holders" }).click();
  await settle(1200);
  await scrollTo(".tabs", 120);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);
  await hidePanels(page);
  await shot("holders");

  await page.goto(`${BASE}/payouts`);
  await settle(1500);
  await shot("payouts");

  // The board on a phone (390 x 844 at 3x).
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.addInitScript(hide);
  const mp = await phone.newPage();
  await mp.goto(`${BASE}/`);
  await mp.waitForLoadState("networkidle");
  await mp.waitForTimeout(2500);
  await mp.screenshot({ path: path.join(OUT, "mobile-board.jpg"), type: "jpeg", quality: 92 });

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
