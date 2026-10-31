"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { short } from "@divvy/shared";
import { BRAND } from "@/lib/brand";
import { useLang, useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";
import { Icon } from "./Icon";
import { useToast } from "./Toasts";

/** Which nav item a path belongs to (prototype `route` nav map). */
export function navOf(path: string): "board" | "payouts" | "how" | "create" {
  const seg = path.split("/")[1] ?? "";
  if (seg === "payouts" || seg === "how" || seg === "create") return seg;
  return "board";
}

export function ConnectButton() {
  const { publicKey, connected } = useWallet();
  const router = useRouter();
  const { setVisible } = useWalletModal();
  const toast = useToast();
  const t = useMsgs(common);
  const was = useRef(connected);
  useEffect(() => {
    if (connected !== was.current) toast(connected ? t.walletConnected : t.walletDisconnected);
    was.current = connected;
  }, [connected, toast, t]);
  const addr = publicKey?.toBase58();
  return (
    <button
      className="btn btn-ghost"
      id="connectBtn"
      type="button"
      aria-label={addr ? t.yourWallet : t.connectWallet}
      onClick={() => (addr ? router.push("/me") : setVisible(true))}
    >
      {addr ? (
        <>
          <span className="wallet-av" />
          {short(addr)}
        </>
      ) : (
        <>
          <span className="lbl-long">{t.connectWallet}</span>
          <span className="lbl-short">{t.connect}</span>
        </>
      )}
    </button>
  );
}

/** 中 / EN: the language for the whole site, kept in a cookie. */
export function LangSwitch() {
  const [lang, setLang] = useLang();
  const t = useMsgs(common);
  return (
    <div className="lang-switch" role="group" aria-label={t.language}>
      <button type="button" lang="zh-CN" aria-pressed={lang === "zh"} onClick={() => lang !== "zh" && setLang("zh")}>中</button>
      <button type="button" lang="en" aria-pressed={lang === "en"} onClick={() => lang !== "en" && setLang("en")}>EN</button>
    </div>
  );
}

export function Header() {
  const t = useMsgs(common);
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const nav = navOf(path);
  const onBoard = path === "/";
  const [q, setQ] = useState(params.get("q") ?? "");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (onBoard) setQ(params.get("q") ?? "");
  }, [onBoard, params]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (e.key === "/" && tag !== "input" && tag !== "textarea") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const onSearch = (v: string) => {
    setQ(v);
    const url = v ? `/?q=${encodeURIComponent(v)}` : "/";
    if (!onBoard) return router.push(url);
    router.replace(url, { scroll: false });
    const g = document.getElementById("grid");
    if (g && g.getBoundingClientRect().top > window.innerHeight * 0.6)
      window.scrollTo({ top: g.getBoundingClientRect().top + window.scrollY - 170, behavior: "smooth" });
  };

  const cur = (k: string) => (nav === k ? { "aria-current": "page" as const } : {});
  return (
    <header className="top">
      <div className="wrap">
        <Link className="logo" href="/" aria-label={t.home}>
          {/* The Koin belah mark and the drawn "hwai" wordmark (brand/hwai). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-lockup" src="/brand/hwai-lockup.svg" alt={BRAND} width={99} height={36} />
        </Link>
        <nav className="links" aria-label="Main">
          <Link href="/" {...cur("board")}>{t.navBoard}</Link>
          <Link href="/payouts" {...cur("payouts")}>{t.navPayouts}</Link>
          <Link href="/how" {...cur("how")}>{t.navHow}</Link>
        </nav>
        <label className="search">
          <span className="sr">{t.searchLabel}</span>
          <span className="ico">
            <Icon name="search" size={15} />
          </span>
          <input ref={input} id="search" type="search" placeholder={t.searchPlaceholder} autoComplete="off" value={q} onChange={(e) => onSearch(e.target.value)} />
          <kbd>/</kbd>
        </label>
        <LangSwitch />
        <Link className="btn btn-g" href="/create" id="createTop">
          {t.createCoin}
        </Link>
        <ConnectButton />
      </div>
    </header>
  );
}
