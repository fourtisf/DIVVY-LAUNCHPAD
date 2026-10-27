// Product shots for the "anyone can launch" video, taken from the site in demo mode (sample data):
// the filled-in create form, the launch modal on its way and the coin that's live.
// Usage: start the demo site (API_MODE=mock API on :4000, web on :3000), then from the repo root:
//   node brand/uspad/src/launch-shots.cjs http://localhost:3000 brand/uspad/social/launch-shots <coin picture.png>
// Each run needs a fresh demo API: the launch below reserves its ticker.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [BASE, OUT, PICTURE] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  // Next's dev badge isn't part of the site.
  await ctx.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(s);
    }),
  );
  const page = await ctx.newPage();
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 94 });
  const settle = (ms = 1200) => page.waitForLoadState("networkidle").then(() => page.waitForTimeout(ms));

  await page.goto(`${BASE}/create`);
  await settle();
  await page.fill("#fName", "Moon Cat");
  await page.fill("#fTick", "MOONCAT");
  await page.fill("#fDesc", "A cat that holds Nvidia.");
  await page.fill("#fX", "x.com/mooncatcoin");
  await page.setInputFiles("#fImg", PICTURE);
  await page.waitForTimeout(2500);
  await page.mouse.move(0, 0);
  await shot("create");

  // The modal mid-way: checks done, the wallet's approval done, the private bundle on its way.
  await page.click("#launchBtn");
  await page.getByText("Sending the create in a private bundle").waitFor();
  await page.waitForTimeout(1300);
  await shot("modal");
  await page.getByRole("button", { name: "Open coin page" }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot("launched");

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
