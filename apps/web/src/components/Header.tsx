"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { short } from "@divvy/shared";
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
  const was = useRef(connected);
  useEffect(() => {
    if (connected !== was.current) toast(connected ? "Wallet connected" : "Wallet disconnected");
    was.current = connected;
  }, [connected, toast]);
  const addr = publicKey?.toBase58();
  return (
    <button
      className="btn btn-ghost"
      id="connectBtn"
      type="button"
      aria-label={addr ? "Your payouts and wallet" : "Connect wallet"}
      onClick={() => (addr ? router.push("/me") : setVisible(true))}
    >
      {addr ? (
        <>
          <span className="wallet-av" />
          {short(addr)}
        </>
      ) : (
        <>
          <span className="lbl-long">Connect wallet</span>
          <span className="lbl-short">Connect</span>
        </>
      )}
    </button>
  );
}

export function Header() {
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
        <Link className="logo" href="/" aria-label="Divvy home">
          <span className="logo-mark" />
          divvy
        </Link>
        <nav className="links" aria-label="Main">
          <Link href="/" {...cur("board")}>Board</Link>
          <Link href="/payouts" {...cur("payouts")}>Payouts</Link>
          <Link href="/how" {...cur("how")}>How it works</Link>
        </nav>
        <label className="search">
          <span className="sr">Search coins</span>
          <span className="ico">
            <Icon name="search" size={15} />
          </span>
          <input ref={input} id="search" type="search" placeholder="Search coins or stocks" autoComplete="off" value={q} onChange={(e) => onSearch(e.target.value)} />
          <kbd>/</kbd>
        </label>
        <Link className="btn btn-g" href="/create" id="createTop">
          Create coin
        </Link>
        <ConnectButton />
      </div>
    </header>
  );
}
