import { expect, test } from "@playwright/test";

// Runs against the mock API: deterministic demo data, no wallet, no chain.

test("board lists coins and opens one", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Memecoins that pay you");
  const first = page.locator("#grid a").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/coin\//);
  await expect(page.getByText("Ticker locked forever")).toBeVisible();
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
  // A leetspeak copy of a demo coin's ticker is refused by the server.
  await page.locator("#fTick").fill("CH1PD0G");
  await expect(page.locator("#checks li").first()).toContainText("Reads as $CHIPDOG");
  await page.locator("#fTick").fill("ZQXWV");
  await expect(page.locator("#checks li").first()).toContainText("$ZQXWV is free");
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
