"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { minutesSince } from "@divvy/shared";
import { LANG_COOKIE, UPDOWN_COOKIE, htmlLang, type Lang, type Msgs, type UpDown } from "./lang";
import { common } from "./msgs/common";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; upDown: UpDown; setUpDown: (u: UpDown) => void };
const LangCtx = createContext<Ctx | null>(null);

const YEAR = 60 * 60 * 24 * 365;
const remember = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`;
};

export function LangProvider({ lang: initialLang, upDown: initialUpDown, children }: { lang: Lang; upDown: UpDown; children: ReactNode }) {
  const router = useRouter();
  const [lang, setLangState] = useState(initialLang);
  const [upDown, setUpDownState] = useState(initialUpDown);
  const setLang = useCallback(
    (l: Lang) => {
      remember(LANG_COOKIE, l);
      document.documentElement.lang = htmlLang(l);
      setLangState(l);
      // Server components (pages, footer, metadata) render again in the new language.
      router.refresh();
    },
    [router],
  );
  const setUpDown = useCallback((u: UpDown) => {
    remember(UPDOWN_COOKIE, u);
    document.documentElement.dataset.updown = u;
    setUpDownState(u);
  }, []);
  const value = useMemo(() => ({ lang, setLang, upDown, setUpDown }), [lang, setLang, upDown, setUpDown]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error("LangProvider missing");
  return c;
}

export const useLang = () => {
  const { lang, setLang } = useCtx();
  return [lang, setLang] as const;
};

export const useUpDown = () => {
  const { upDown, setUpDown } = useCtx();
  return [upDown, setUpDown] as const;
};

/** A client component's messages in the visitor's language. */
export function useMsgs<T>(m: Msgs<T>): T {
  return m[useCtx().lang];
}

/** "12 分钟前" / "12m ago" for a timestamp, in the visitor's language. */
export function useAgo(): (at: string | number | Date, now?: number) => string {
  const t = useMsgs(common);
  return (at, now) => t.ago(minutesSince(at, now));
}
