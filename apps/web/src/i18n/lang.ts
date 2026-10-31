/**
 * Languages and the up/down colour setting (owner, 2026-10-31: hwai is a Chinese-first site, with
 * English one click away). Both live in cookies so the server renders the right one first time.
 *
 * Messages sit next to nothing else: each area has a file in ./msgs with an `en` and a `zh` object of
 * the same shape (defineMsgs checks that). Server components read them with getMsgs (./server),
 * client components with useMsgs (./client).
 */
export type Lang = "zh" | "en";
export const DEFAULT_LANG: Lang = "zh";
export const LANG_COOKIE = "lang";

/** "intl": green up, red down (Binance and OKX's default). "cn": red up, green down (A-share apps). */
export type UpDown = "intl" | "cn";
export const DEFAULT_UPDOWN: UpDown = "intl";
export const UPDOWN_COOKIE = "updown";

export const parseLang = (v: string | undefined | null): Lang => (v === "en" || v === "zh" ? v : DEFAULT_LANG);
export const parseUpDown = (v: string | undefined | null): UpDown => (v === "cn" || v === "intl" ? v : DEFAULT_UPDOWN);

/** The `lang` attribute for <html>. */
export const htmlLang = (l: Lang): string => (l === "zh" ? "zh-CN" : "en");

export type Msgs<T> = { en: T; zh: T };

/** One area's messages. `zh` must have exactly `en`'s shape, so a missing translation fails typecheck. */
export function defineMsgs<T>(en: T, zh: NoInfer<T>): Msgs<T> {
  return { en, zh };
}
