import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { expect, test, type Page } from "@playwright/test";

/**
 * The creator-signed launch, end to end in a real browser (owner decision 2026-10-27: the creator's
 * wallet signs and pays for its coin's create). The mock API hands a signed-in wallet the same create
 * the worker builds; a Wallet Standard test wallet, like Phantom or Solflare, signs it with Ed25519.
 *
 * This path runs the page's checks on the browser's own Buffer (Next.js's polyfill). Unit tests run on
 * Node's, which is how "g.readBigUInt64LE is not a function" stopped every mainnet launch on 2026-10-28
 * with all tests green.
 */

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGMwnplGU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAHLzyD0U3RLHAAAAAElFTkSuQmCC", "base64");

/** Runs in the page before the app: registers the test wallet and has the app connect to it. */
function testWallet({ address, pub, jwk }: { address: string; pub: number[]; jwk: JsonWebKey }) {
  const w = window as unknown as { __wallet: { signed: number; reject: boolean } };
  w.__wallet = { signed: 0, reject: false };
  const key = crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  const ed25519 = async (msg: Uint8Array) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, await key, msg));
  const chains = ["solana:mainnet", "solana:devnet"] as const;
  const account = { address, publicKey: new Uint8Array(pub), chains, features: ["solana:signTransaction", "solana:signMessage"] };
  let connected = false;
  const listeners: Record<string, ((p: unknown) => void)[]> = {};
  const wallet = {
    version: "1.0.0",
    name: "Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    chains,
    get accounts() {
      return connected ? [account] : [];
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          connected = true;
          for (const f of listeners.change ?? []) f({ accounts: [account] });
          return { accounts: [account] };
        },
      },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => void (connected = false) },
      "standard:events": {
        version: "1.0.0",
        on: (event: string, f: (p: unknown) => void) => {
          (listeners[event] ??= []).push(f);
          return () => (listeners[event] = (listeners[event] ?? []).filter((x) => x !== f));
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: (...inputs: { transaction: Uint8Array }[]) =>
          Promise.all(
            inputs.map(async ({ transaction }) => {
              if (w.__wallet.reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
              // The fee payer signs first: [signature count][signatures][message], with fewer than 128 signers.
              const tx = new Uint8Array(transaction);
              tx.set(await ed25519(tx.slice(1 + 64 * tx[0]!)), 1);
              w.__wallet.signed++;
              return { signedTransaction: tx };
            }),
          ),
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: (...inputs: { message: Uint8Array }[]) => Promise.all(inputs.map(async ({ message }) => ({ signedMessage: message, signature: await ed25519(message) }))),
      },
    },
  };
  const register = ({ register }: { register: (w: unknown) => void }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => register((e as CustomEvent).detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  localStorage.setItem("walletName", JSON.stringify("Test Wallet"));
}

/** A fresh test wallet in the page, signed in to the API (the session the site's sign-in makes). */
async function walletSignedIn(page: Page): Promise<string> {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.from(jwk.x!, "base64url");
  const address = bs58.encode(pub);
  await page.addInitScript(testWallet, { address, pub: [...pub], jwk });
  const n = (await (await page.request.get(`/api/auth/nonce?address=${address}`)).json()) as { nonce: string; message: string };
  const res = await page.request.post("/api/auth/verify", { data: { address, nonce: n.nonce, signature: bs58.encode(sign(null, Buffer.from(n.message), privateKey)) } });
  expect(res.ok()).toBe(true);
  return address;
}

async function fillCreate(page: Page): Promise<string> {
  const ticker = "SG" + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z]/g, "X");
  await page.goto("/create");
  await page.locator("#fName").fill("Signed Cat");
  await page.locator("#fTick").fill(ticker);
  await page.locator("#fImg").setInputFiles({ name: "cat.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator("#launchBtn")).toBeEnabled({ timeout: 15_000 });
  return ticker;
}

test.describe("creator-signed launch", () => {
  test.skip(({ isMobile }) => isMobile, "Android pages offer the Mobile Wallet Adapter instead of browser wallets");

  test("the creator's wallet signs the create and the coin goes live", async ({ page }) => {
    await walletSignedIn(page);
    const ticker = await fillCreate(page);
    await page.locator("#launchBtn").click();
    // The API only moves on once it has checked the wallet's signature against the create it handed over.
    await expect(page.getByRole("heading", { name: `$${ticker} is live` })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __wallet: { signed: number } }).__wallet.signed)).toBe(1);
    await expect(page.getByText(/Your wallet didn't sign it/)).toHaveCount(0);
  });

  test("a dev buy rides in the create the wallet signs, and the coin shows it (owner decision 2026-10-28)", async ({ page }) => {
    await walletSignedIn(page);
    const ticker = await fillCreate(page);
    // The quick picks fill the field (owner request 2026-10-28).
    await page.locator("#devQuick").getByRole("button", { name: "0.5 SOL", exact: true }).click();
    await expect(page.locator("#devSum")).toContainText("0.5 SOL, about 1.7%");
    await page.locator("#devQuick").getByRole("button", { name: "1 SOL", exact: true }).click();
    await expect(page.locator("#fDev")).toHaveValue("1");
    await expect(page.locator("#devSum")).toContainText("1 SOL, about 3.4%");
    await page.locator("#launchBtn").click();
    // The page checked the create holds exactly this dev buy before the wallet saw it.
    await expect(page.getByRole("heading", { name: `$${ticker} is live` })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __wallet: { signed: number } }).__wallet.signed)).toBe(1);
    // The coin page shows everyone how much the creator bought.
    await page.getByRole("button", { name: "Open coin page" }).click();
    // The dev server may compile the coin page first.
    await expect(page.locator("#devBuyTag")).toContainText(/Dev bought 3\.\d%/, { timeout: 30_000 });
  });

  test("a dev buy outside 0.01 to 80 SOL can't be launched", async ({ page }) => {
    await walletSignedIn(page);
    await fillCreate(page);
    await page.locator("#fDev").fill("81");
    await expect(page.locator("#launchBtn")).toBeDisabled();
    await expect(page.locator("#devNote")).toContainText("from 0.01 to 80 SOL");
  });

  test("turning it down in the wallet ends the launch with nothing charged", async ({ page }) => {
    await walletSignedIn(page);
    await fillCreate(page);
    await page.evaluate(() => void ((window as unknown as { __wallet: { reject: boolean } }).__wallet.reject = true));
    await page.locator("#launchBtn").click();
    await expect(page.locator("#launchHint")).toContainText("You turned the launch down in your wallet", { timeout: 20_000 });
  });
});
