import { describe, expect, it } from "vitest";
import {
  checkName,
  checkTicker,
  checkX,
  displayTicker,
  foldName,
  foldTicker,
  normalizeXHandle,
  similarity,
  xProfileUrl,
  type CoinIdentity,
} from "../src/antivamp";

const coins: (CoinIdentity & { nameNorm: string; x: string })[] = [
  { ticker: "CHIPDOG", name: "Chip Dog", mint: null, x: "degenkara" },
  { ticker: "FROG", name: "Frog Lord", mint: null, x: "mochitrades" },
  { ticker: "DUCK", name: "Dividend Duck", mint: null, x: "solsamurai" },
].map((c) => ({ ...c, nameNorm: foldName(c.name) }));
const reserved = new Set(["PEPE", "BONK", "WIF", "SOL", "USDC"]);

const tickerCtx = {
  findByTickerNorm: (n: string) => coins.find((c) => foldTicker(c.ticker) === n),
  isReserved: (n: string) => reserved.has(n),
};
const nameCtx = { candidates: () => coins };
const xCtx = { findByX: (h: string) => coins.find((c) => c.x === h) };

describe("foldTicker", () => {
  it("upper-cases and strips everything but letters and digits", () => {
    expect(foldTicker(" chip-dog ")).toBe("CHIPDOG");
    expect(foldTicker("chip dog!")).toBe("CHIPDOGI"); // "!" is leet for I, same as the prototype
  });

  it("folds leetspeak: 0→O 1→I 3→E 4→A 5→S 7→T 8→B $→S @→A", () => {
    expect(foldTicker("CH1PD0G")).toBe("CHIPDOG");
    expect(foldTicker("P3P3")).toBe("PEPE");
    expect(foldTicker("B0NK")).toBe("BONK");
    expect(foldTicker("4B5T78")).toBe("ABSTTB");
    expect(foldTicker("W@G$")).toBe("WAGS");
    expect(foldTicker("|NTERN")).toBe("INTERN");
  });

  it("treats one leading $ as ticker notation", () => {
    expect(foldTicker("$WIF")).toBe("WIF");
    expect(foldTicker("$$WIF")).toBe("SWIF");
  });

  it("folds Cyrillic and Greek homoglyphs", () => {
    expect(foldTicker("СНІРDОG")).toBe("CHIPDOG"); // Cyrillic С Н І О
    expect(foldTicker("рере")).toBe("PEPE"); // all-Cyrillic lower case
    expect(foldTicker("ΒΟΝΚ")).toBe("BONK"); // Greek Β Ο Ν Κ
    expect(foldTicker("ԜIF")).toBe("WIF");
  });

  it("folds fullwidth and accented letters", () => {
    expect(foldTicker("ＣＨＩＰＤＯＧ")).toBe("CHIPDOG");
    expect(foldTicker("PÉPÉ")).toBe("PEPE");
  });

  it("keeps digits that have no letter twin", () => {
    expect(foldTicker("PEPE2")).toBe("PEPE2");
  });
});

describe("displayTicker", () => {
  it("keeps the typed digits but folds homoglyphs", () => {
    expect(displayTicker("ch1pdog")).toBe("CH1PDOG");
    expect(displayTicker("$СНІР")).toBe("CHIP");
  });
});

describe("checkTicker", () => {
  it("is idle when empty", () => {
    expect(checkTicker("  ", tickerCtx)).toMatchObject({ status: "idle", message: "Type a ticker" });
  });

  it("enforces 2 to 10 characters after folding", () => {
    expect(checkTicker("A", tickerCtx)).toMatchObject({ status: "fail", code: "TICKER_LENGTH", message: "Use 2 to 10 letters or numbers" });
    expect(checkTicker("ABCDEFGHIJK", tickerCtx).code).toBe("TICKER_LENGTH");
  });

  it("refuses symbols instead of dropping them (audit: BONK! was checked as BONKI but minted as BONK)", () => {
    for (const t of ["CHIPDOG!", "CH|PDOG", "$$CHIPDOG", "C@OW", "!!", "chip dog", "W@G$"]) {
      const r = checkTicker(t, tickerCtx);
      expect(r, t).toMatchObject({ status: "fail", code: "TICKER_CHARS", message: "Use letters and numbers only" });
    }
    // One leading $ is ticker notation, and look-alike letters still fold to the taken ticker.
    expect(checkTicker("$CH1PD0G", tickerCtx).code).toBe("TICKER_TAKEN");
    expect(checkTicker("СНІРDОG", tickerCtx).code).toBe("TICKER_TAKEN");
    expect(checkTicker("A-B", tickerCtx).code).toBe("TICKER_CHARS");
  });

  it("refuses leetspeak and homoglyph copies with the owner named", () => {
    for (const t of ["CH1PD0G", "chipdog", "СНІРDОG", "ＣＨＩＰＤＯＧ", "$chipdog"]) {
      const r = checkTicker(t, tickerCtx);
      expect(r).toMatchObject({ status: "fail", code: "TICKER_TAKEN", message: "Reads as $CHIPDOG, which belongs to Chip Dog" });
      expect(r.collidesWith).toEqual({ ticker: "CHIPDOG", name: "Chip Dog", mint: null });
    }
  });

  it("refuses tickers already trading elsewhere", () => {
    expect(checkTicker("P3P3", tickerCtx)).toMatchObject({ code: "TICKER_RESERVED", message: "$PEPE already trades elsewhere with real volume" });
    expect(checkTicker("ΒΟΝΚ", tickerCtx).code).toBe("TICKER_RESERVED");
  });

  it("accepts a new ticker", () => {
    expect(checkTicker("moonpig", tickerCtx)).toMatchObject({ status: "ok", message: "$MOONPIG is free" });
  });
});

describe("foldName", () => {
  it("strips official / real / the / og / v2 / ii / 2.0 and trailing digits", () => {
    const variants = [
      "Chip Dog",
      "Chip Dog Official",
      "The Real Chip Dog",
      "Official Chip Dog",
      "OG Chip Dog",
      "Chip Dog 2",
      "Chip Dog2",
      "Chip Dog 2!",
      "Chip Dog v2",
      "Chip Dog V3",
      "Chip Dog II",
      "Chip Dog 2.0",
      "chip-dog (official)",
      "CHIP DOG 2025",
    ];
    for (const v of variants) expect(foldName(v), v).toBe("chipdog");
  });

  it("folds Cyrillic homoglyphs, accents and leetspeak digits", () => {
    expect(foldName("Сhір Dоg")).toBe("chipdog"); // Cyrillic С і р о
    expect(foldName("Chíp Dóg")).toBe("chipdog");
    expect(foldName("Ch1p D0g")).toBe("chipdog");
  });

  it("does not strip those words when they are part of another word", () => {
    expect(foldName("Theory Dog")).toBe("theorydog");
    expect(foldName("Realm Frog")).toBe("realmfrog");
  });
});

describe("checkName", () => {
  it("refuses names at or above 0.84 similarity", () => {
    expect(checkName("Chip Dog Official", nameCtx)).toMatchObject({ status: "fail", code: "NAME_SIMILAR", message: "Too close to “Chip Dog”" });
    expect(checkName("Chip Dogg", nameCtx).code).toBe("NAME_SIMILAR"); // 1 edit in 8 = 0.875
    expect(checkName("Frog Lord 2", nameCtx).code).toBe("NAME_SIMILAR");
    expect(checkName("Dividend Ducks", nameCtx).code).toBe("NAME_SIMILAR");
  });

  it("accepts names below the threshold", () => {
    expect(similarity("chipdog", "chipcat")).toBeLessThan(0.84);
    expect(checkName("Chip Cat", nameCtx)).toMatchObject({ status: "ok", message: "No coin has a similar name" });
  });

  it("handles empty and too-short names", () => {
    expect(checkName("", nameCtx).status).toBe("idle");
    expect(checkName("The OG", nameCtx)).toMatchObject({ code: "NAME_TOO_SHORT", message: "The name is too short" });
  });
});

describe("checkX", () => {
  it("is optional", () => {
    expect(checkX("", xCtx)).toMatchObject({ status: "ok", code: "X_EMPTY" });
    expect(checkX("@", xCtx).code).toBe("X_EMPTY");
  });
  it("validates the handle format", () => {
    expect(checkX("not a handle", xCtx).code).toBe("X_INVALID");
    expect(checkX("@abcdefghijklmnop", xCtx).code).toBe("X_INVALID");
  });
  it("takes the profile's link, as X's share button gives it", () => {
    for (const link of ["https://x.com/uspadfun?s=11", "x.com/uspadfun", "https://twitter.com/USPADFUN/", "http://www.x.com/uspadfun#top", "mobile.twitter.com/uspadfun"])
      expect(normalizeXHandle(link)).toBe("uspadfun");
    expect(normalizeXHandle("https://x.com/uspadfun/status/1")).toBeNull();
    expect(normalizeXHandle("https://example.com/uspadfun")).toBeNull();
    expect(checkX("https://x.com/DegenKara", xCtx).code).toBe("X_TAKEN");
    expect(xProfileUrl("UspadFun")).toBe("https://x.com/uspadfun");
  });
  it("allows one coin per account, case-insensitively", () => {
    expect(checkX("@DegenKara", xCtx)).toMatchObject({ code: "X_TAKEN", message: "@degenkara already launched $CHIPDOG" });
    expect(checkX("newperson", xCtx)).toMatchObject({ status: "ok", message: "@newperson has no coin yet" });
  });
});
