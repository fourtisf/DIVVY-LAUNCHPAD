import { expect, test } from "@playwright/test";

// Runs against the mock API: deterministic demo data, no wallet, no chain.

test("board lists coins and opens one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Memecoins that pay you");
  const first = page.locator("#grid a").first();
  await expect(first).toBeVisible();
  await first.click();
  // Coin pages open by mint: coins can share a ticker.
  await expect(page).toHaveURL(/\/coin\/[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  await expect(page.getByRole("heading", { name: "Check the address" })).toBeVisible();
});

test("search filters the board", async ({ page, isMobile }) => {
  test.skip(isMobile, "the search box is in the desktop header");
  await page.goto("/");
  await page.locator("#search").fill("zzzz-no-such-coin");
  await expect(page.locator("#grid .empty")).toBeVisible();
});

test("payouts page shows receipts", async ({ page }) => {
  await page.goto("/payouts");
  await expect(page.getByRole("heading", { name: "Payouts" })).toBeVisible();
  await expect(page.locator("#rcpt tr").first()).toBeVisible();
});

test("how it works and terms render", async ({ page }) => {
  await page.goto("/how");
  await expect(page.getByText("Holders are paid every hour")).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();
});

test("create form runs the server checks", async ({ page }) => {
  await page.goto("/create");
  // Symbols are refused by the server; a demo coin's ticker can be used again (owner decision 2026-10-27).
  await page.locator("#fTick").fill("CHIP!");
  await expect(page.locator("#checks li").first()).toContainText("Use letters and numbers only");
  await page.locator("#fTick").fill("CHIPDOG");
  await expect(page.locator("#checks li").first()).toContainText("Reads as $CHIPDOG");
  await expect(page.locator("#launchBtn")).toBeDisabled();
});

test("report a coin", async ({ page }) => {
  await page.goto("/");
  await page.locator("#grid a").first().click();
  await page.getByRole("button", { name: "Report" }).click();
  await page.getByLabel("It's a scam").check();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thanks. We'll take a look.")).toBeVisible();
});

test("your payouts asks for a wallet", async ({ page }) => {
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Your payouts" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Connect wallet" })).toBeVisible();
});

test("unknown pages show the not-found state", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.getByText("This page doesn't exist.")).toBeVisible();
});

test("the admin page is a plain 404 to anyone but a signed-in admin (owner request 2026-10-28)", async ({ page }) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("This page doesn't exist.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin" })).toHaveCount(0);
  expect((await page.request.get("/api/admin/overview")).status()).toBe(404);
});

test("a coin that shares a ticker keeps its own page (owner decision 2026-10-27)", async ({ page, request }) => {
  // A second $TAPE, launched through the mock API like the create form does.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGMwnplGU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAHLzyD0U3RLHAAAAAElFTkSuQmCC", "base64");
  const up = await (await request.post("/api/upload", { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } } })).json();
  const res = await request.post("/api/launch", { data: { name: "Ticker Tape", ticker: "TAPE", imageId: up.imageId, dividendAsset: "NVDAx" } });
  expect(res.status()).toBe(201);
  const { launchId } = await res.json();
  let mint = "";
  await expect(async () => {
    const s = await (await request.get(`/api/launch/${launchId}`)).json();
    expect(s.step).toBe("indexed");
    mint = s.mint;
  }).toPass({ timeout: 15_000 });

  await page.goto(`/coin/${mint}`);
  // :visible skips the copy React streams in hidden before it swaps it into place.
  const ca = page.locator("#copyCa:visible");
  await expect(ca).toContainText(mint.slice(0, 4));
  // The page refreshes the coin every 8 s; it must stay on this coin, not the first $TAPE.
  await page.waitForTimeout(9_000);
  await expect(ca).toContainText(mint.slice(0, 4));

  // A ticker link that matches several coins lists them (each project launches another $TAPE).
  await page.goto("/coin/TAPE");
  await expect(page.locator(".page-lede:visible")).toContainText(/\d+ coins use this ticker/);
  await expect(page.locator(`.grid a[href="/coin/${mint}"]:visible`)).toBeVisible();
});
