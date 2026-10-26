/**
 * Anti-vamp normalisation and checks (HANDOFF §5).
 *
 * These functions are pure and run in both places:
 * - the API, which is the authority (it also enforces unique indexes on tickerNorm, xUserId, imageSha256);
 * - the browser, only for live feedback.
 *
 * Ported from the prototype's foldTicker / foldName / checkTicker / checkName / checkX, with these
 * deliberate hardenings (all stricter, none looser):
 * - Unicode NFKD + combining-mark removal first, so fullwidth, accented and styled letters fold too.
 * - A wider Cyrillic/Greek confusables table, applied to names as well as tickers.
 * - A single leading "$" is treated as ticker notation and dropped ("$WIF" reads as WIF, not SWIF).
 * - Names fold leetspeak digits after trailing digits are removed ("Ch1p D0g" reads as "chipdog").
 */

export type CheckStatus = "idle" | "ok" | "fail";

export type CheckCode =
  | "TICKER_EMPTY"
  | "TICKER_LENGTH"
  | "TICKER_CHARS"
  | "TICKER_TAKEN"
  | "TICKER_RESERVED"
  | "TICKER_OK"
  | "NAME_EMPTY"
  | "NAME_TOO_SHORT"
  | "NAME_SIMILAR"
  | "NAME_OK"
  | "X_EMPTY"
  | "X_INVALID"
  | "X_TAKEN"
  | "X_OK"
  | "IMAGE_EMPTY"
  | "IMAGE_TYPE"
  | "IMAGE_SIZE"
  | "IMAGE_DUPLICATE"
  | "IMAGE_SIMILAR"
  | "IMAGE_OK";

export interface Collision {
  ticker: string;
  name: string;
  mint: string | null;
}

export interface CheckResult {
  status: CheckStatus;
  code: CheckCode;
  /** Shown verbatim in the UI. */
  message: string;
  collidesWith: Collision | null;
}

export const TICKER_MIN = 2;
export const TICKER_MAX = 10;
export const NAME_SIMILARITY_LIMIT = 0.84;
export const IMAGE_HAMMING_LIMIT = 6;

/**
 * Visual confusables, keyed by the character as typed (case preserved) and mapped to the Latin letter
 * it imitates. Tickers are upper-cased first, so their lookups hit the capital rows.
 */
export const HOMOGLYPHS: Readonly<Record<string, string>> = {
  // Cyrillic capitals
  А: "A", В: "B", Е: "E", Ѕ: "S", І: "I", Ј: "J", К: "K", М: "M", Н: "H", О: "O", Р: "P",
  С: "C", Т: "T", Х: "X", У: "Y", Ү: "Y", Ԛ: "Q", Ԝ: "W", Ӏ: "I",
  // Cyrillic lower case
  а: "a", е: "e", ѕ: "s", і: "i", ј: "j", о: "o", р: "p", с: "c", х: "x", у: "y", ү: "y",
  ԁ: "d", һ: "h", ӏ: "l", ԛ: "q", ԝ: "w",
  // Greek capitals
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P",
  Τ: "T", Υ: "Y", Χ: "X",
  // Greek lower case
  α: "a", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
};

/** Leetspeak folds from HANDOFF §5, plus "!" and "|" from the prototype. */
export const LEET: Readonly<Record<string, string>> = {
  "0": "O", "1": "I", "3": "E", "4": "A", "5": "S", "7": "T", "8": "B",
  $: "S", "@": "A", "!": "I", "|": "I",
};

const LEET_DIGITS_LOWER: Readonly<Record<string, string>> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
};

/** Words that don't make a name new (HANDOFF §5: official / real / the / og / v2 / ii). */
const NAME_STOPWORDS = new Set(["official", "real", "the", "og", "ii", "iii"]);

function stripMarks(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "");
}

function mapChars(s: string, ...tables: Readonly<Record<string, string>>[]): string {
  let out = "";
  for (const ch of s) {
    let mapped: string | undefined;
    for (const t of tables) {
      mapped = t[ch];
      if (mapped !== undefined) break;
    }
    out += mapped ?? ch;
  }
  return out;
}

function prepTicker(input: string): string {
  return stripMarks(input).trim().replace(/^\$/, "").toUpperCase();
}

/** The ticker as stored and shown: upper case, homoglyphs folded, letters and digits only. */
export function displayTicker(input: string): string {
  return mapChars(prepTicker(input), HOMOGLYPHS).replace(/[^A-Z0-9]/g, "");
}

/** The ticker's identity for uniqueness (tickerNorm): displayTicker plus leetspeak folding. */
export function foldTicker(input: string): string {
  return mapChars(prepTicker(input), HOMOGLYPHS, LEET).replace(/[^A-Z0-9]/g, "");
}

/** The name's identity for similarity (nameNorm). */
export function foldName(input: string): string {
  let s = mapChars(stripMarks(input), HOMOGLYPHS).toLowerCase();
  s = s.replace(/(^|[^a-z0-9])2\.0(?![a-z0-9])/g, "$1 ");
  const tokens = s
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !NAME_STOPWORDS.has(t) && !/^v\d+$/.test(t));
  const joined = tokens.join("").replace(/\d+$/, "");
  return mapChars(joined, LEET_DIGITS_LOWER);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

/** 1 - normalised Levenshtein distance; 0 when either side is empty. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Normalises a typed X handle. Returns null if it isn't a valid handle. */
export function normalizeXHandle(input: string): string | null {
  const h = input.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(h) ? h : null;
}

export interface CoinIdentity {
  ticker: string;
  name: string;
  mint: string | null;
}

export interface TickerContext {
  /** Coin already using this tickerNorm, if any. */
  findByTickerNorm(norm: string): CoinIdentity | undefined;
  /** True if the folded ticker is on the "already trading with real volume" list. */
  isReserved(norm: string): boolean;
}

export interface NameContext {
  /** Every existing coin with its nameNorm. The API pre-filters candidates in production (pg_trgm). */
  candidates(): Iterable<CoinIdentity & { nameNorm: string }>;
}

export interface XContext {
  /** Coin launched by this X account. In production the key is the OAuth-verified user ID, not the handle. */
  findByX(handle: string): CoinIdentity | undefined;
}

const result = (
  status: CheckStatus,
  code: CheckCode,
  message: string,
  hit?: CoinIdentity,
): CheckResult => ({
  status,
  code,
  message,
  collidesWith: hit ? { ticker: hit.ticker, name: hit.name, mint: hit.mint } : null,
});

export function checkTicker(input: string, ctx: TickerContext): CheckResult {
  if (!input.trim()) return result("idle", "TICKER_EMPTY", "Type a ticker");
  // Only letters, digits (and look-alike letters, which fold). Symbols are refused rather than dropped:
  // "BONK!" would otherwise be checked as BONKI but minted as BONK.
  if (/[^A-Z0-9]/.test(mapChars(prepTicker(input), HOMOGLYPHS))) return result("fail", "TICKER_CHARS", "Use letters and numbers only");
  const norm = foldTicker(input);
  if (norm.length < TICKER_MIN || norm.length > TICKER_MAX)
    return result("fail", "TICKER_LENGTH", `Use ${TICKER_MIN} to ${TICKER_MAX} letters or numbers`);
  const hit = ctx.findByTickerNorm(norm);
  if (hit) return result("fail", "TICKER_TAKEN", `Reads as $${hit.ticker}, which belongs to ${hit.name}`, hit);
  if (ctx.isReserved(norm)) return result("fail", "TICKER_RESERVED", `$${norm} already trades elsewhere with real volume`);
  return result("ok", "TICKER_OK", `$${displayTicker(input)} is free`);
}

export function checkName(input: string, ctx: NameContext): CheckResult {
  if (!input.trim()) return result("idle", "NAME_EMPTY", "Type a name");
  const norm = foldName(input);
  if (norm.length < 2) return result("fail", "NAME_TOO_SHORT", "The name is too short");
  for (const c of ctx.candidates()) {
    if (similarity(c.nameNorm, norm) >= NAME_SIMILARITY_LIMIT)
      return result("fail", "NAME_SIMILAR", `Too close to “${c.name}”`, c);
  }
  return result("ok", "NAME_OK", "No coin has a similar name");
}

export function checkX(input: string, ctx: XContext): CheckResult {
  if (!input.trim().replace(/^@/, "")) return result("ok", "X_EMPTY", "Optional. Linking one makes the coin yours for good");
  const h = normalizeXHandle(input);
  if (!h) return result("fail", "X_INVALID", "That isn't a valid X handle");
  const hit = ctx.findByX(h);
  if (hit) return result("fail", "X_TAKEN", `@${h} already launched $${hit.ticker}`, hit);
  return result("ok", "X_OK", `@${h} has no coin yet`);
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Type and size gate. Hash comparison happens server-side after decoding (see imagehash.ts). */
export function checkImageFile(type: string, bytes: number, maxBytes = IMAGE_MAX_BYTES): CheckResult | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) return result("fail", "IMAGE_TYPE", "Use a PNG, JPG, WEBP or GIF");
  if (bytes > maxBytes) return result("fail", "IMAGE_SIZE", `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB`);
  return null;
}

export const imageIdle = (): CheckResult => result("idle", "IMAGE_EMPTY", "Upload a picture");
export const imageOk = (): CheckResult => result("ok", "IMAGE_OK", "No coin uses this picture");
export const imageCollision = (hit: CoinIdentity, exact: boolean): CheckResult =>
  result("fail", exact ? "IMAGE_DUPLICATE" : "IMAGE_SIMILAR", `Looks like the picture of $${hit.ticker}`, hit);

/** Lookalike examples for the coin page's copy-protection panel (prototype `leetify`). */
export function leetExamples(ticker: string): string {
  const l = ticker.replace(/O/g, "0").replace(/A/g, "4").replace(/E/g, "3").replace(/I/g, "1").replace(/S/g, "5");
  return l !== ticker ? `${l} or ${ticker.toLowerCase()}` : `${ticker.toLowerCase()} or ${ticker.split("").join(" ")}`;
}
