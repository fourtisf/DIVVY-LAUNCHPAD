// Product shots for the "uspad is live" video, taken from the site in demo mode (sample data).
// Usage: start the demo site (API_MODE=mock API on :4000, web on :3000), then from the repo root:
//   node brand/uspad/src/live-shots.cjs http://localhost:3000 brand/uspad/social/live-shots <coin picture.png>
// Each run needs a fresh demo API: the launch below refuses a picture it has seen.
const { chromium } = require("playwright");
const path = require("path");

const [BASE, OUT, PICTURE] = process.argv.slice(2);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 92 });

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const settle = (ms = 1200) => page.waitForLoadState("networkidle").then(() => page.waitForTimeout(ms));

  await page.goto(`${BASE}/`);
  await settle(2500);
  await shot(page, "board");

  await page.goto(`${BASE}/create`);
  await settle();
  await page.fill("#fName", "Moon Cat");
  await page.fill("#fTick", "MOONCAT");
  await page.fill("#fDesc", "A cat that holds Nvidia.");
  await page.fill("#fX", "x.com/mooncatcoin");
  await page.setInputFiles("#fImg", PICTURE);
  await page.waitForTimeout(2500);
  await page.mouse.move(0, 0);
  await shot(page, "create");

  await page.click("#launchBtn");
  await page.getByRole("button", { name: "Open coin page" }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await shot(page, "launched");

  await page.goto(`${BASE}/coin/CHIPDOG`);
  await settle(2000);
  await page.getByRole("button", { name: "15m", exact: true }).click();
  await page.getByRole("button", { name: "Market cap", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, document.querySelector(".coin-grid").getBoundingClientRect().top + window.scrollY - 150));
  await page.waitForTimeout(800);
  const plot = await page.locator(".cchart-plot").boundingBox();
  await page.mouse.move(plot.x + plot.width * 0.72, plot.y + plot.height * 0.35);
  await page.waitForTimeout(500);
  await shot(page, "coin");

  await page.goto(`${BASE}/payouts`);
  await settle(1500);
  await shot(page, "payouts");

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
