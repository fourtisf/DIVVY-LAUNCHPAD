import { describe, expect, it } from "vitest";
import { coinMatches, parseCoinSearch } from "../src/search";

const coin = { mint: "3sDaJhs5GRqbowhQjoKQ5pe3R4mwYr9TUzWawEjnqsvG", name: "uspad", ticker: "USPAD", stocks: ["NVDAx", "Nvidia"] };
const finds = (q: string) => coinMatches(coin, parseCoinSearch(q));

describe("coin search", () => {
  it("finds a coin by its whole CA, even with what a copy brings along (2026-10-28)", () => {
    expect(finds("3sDaJhs5GRqbowhQjoKQ5pe3R4mwYr9TUzWawEjnqsvG")).toBe(true);
    expect(finds("3sDaJhs5GRqbowhQjoKQ5pe3R4mwYr9TUzWawEjnqsvG\\")).toBe(true);
    expect(finds(' "3sDaJhs5GRqbowhQjoKQ5pe3R4mwYr9TUzWawEjnqsvG" ')).toBe(true);
  });

  it("finds it by a piece of the CA, case and all", () => {
    expect(finds("EjnqsvG")).toBe(true);
    expect(finds("ejnqsvg")).toBe(false);
    expect(finds("3sDaJ")).toBe(false); // under 6 characters: too short to mean a CA
  });

  it("finds it by ticker with or without $, by name and by stock", () => {
    expect(finds("USPAD")).toBe(true);
    expect(finds("$uspad")).toBe(true);
    expect(finds("usp")).toBe(true);
    expect(finds("nvdax")).toBe(true);
    expect(finds("dogcoin")).toBe(false);
  });

  it("matches everything when there's nothing to look for", () => {
    expect(finds("  $ ")).toBe(true);
  });
});
