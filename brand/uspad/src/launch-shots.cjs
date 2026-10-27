// Product shots for the "anyone can launch" video, taken from the site in demo mode (sample data):
// the create form filled in keystroke by keystroke (type-NN.jpg, with the fields' positions in
// type.json), the form at the dividend picker, the launch modal on its way, the coin that's live, and
// a coin page on a phone (mobile-coin.jpg).
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

  // Typing, one frame per keystroke, with the page scrolled past its lede (which describes demo mode).
  await page.goto(`${BASE}/create`);
  await settle();
  const top = () => page.evaluate(() => window.scrollTo(0, 300));
  await top();
  await page.waitForTimeout(500);
  const box = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    return [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 2));
  };
  const pos = { name: await box("#fName"), ticker: await box("#fTick"), picture: await box('label[for="fImg"]') };
  let n = 0;
  const frame = async (ms = 140) => {
    await top();
    await page.waitForTimeout(ms);
    await page.screenshot({ path: path.join(OUT, `type-${String(n++).padStart(2, "0")}.jpg`), type: "jpeg", quality: 90 });
  };
  await page.mouse.move(0, 0);
  await frame();
  await page.click("#fName");
  for (const ch of "Moon Cat") {
    await page.keyboard.type(ch);
    await frame();
  }
  await page.click("#fTick");
  for (const ch of "MOONCAT") {
    await page.keyboard.type(ch);
    await frame();
  }
  await page.setInputFiles("#fImg", PICTURE);
  await frame(2500);
  fs.writeFileSync(path.join(OUT, "type.json"), JSON.stringify({ scale: 2, frames: n, ...pos }, null, 1));

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

  // A coin page on a phone (390 x 844 at 3x).
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await phone.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(s);
    }),
  );
  const mp = await phone.newPage();
  await mp.goto(`${BASE}/coin/CHIPDOG`);
  await mp.waitForLoadState("networkidle");
  await mp.waitForTimeout(2500);
  await mp.screenshot({ path: path.join(OUT, "mobile-coin.jpg"), type: "jpeg", quality: 92 });

  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
