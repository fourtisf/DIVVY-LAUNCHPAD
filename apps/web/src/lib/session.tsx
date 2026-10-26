"use client";

/**
 * Sign-in with Solana (HANDOFF §6): the API hands out a single-use nonce message, the wallet signs it,
 * and the API sets an httpOnly session cookie. Sign-in only happens when an action needs it
 * (uploading, launching, claiming), never on connect.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import useSWR from "swr";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { Me } from "@divvy/shared";
import { api, ApiRequestError } from "./api";

interface Session {
  me: Me | undefined;
  /** Resolves true once the connected wallet has a session; prompts to connect or sign if needed. */
  ensureSignedIn(): Promise<boolean>;
  signOut(): Promise<void>;
  refresh(): Promise<unknown>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { data: me, mutate } = useSWR<Me>("/api/me", { revalidateOnFocus: true });
  const inFlight = useRef<Promise<boolean> | null>(null);
  const wallet = publicKey?.toBase58() ?? null;

  // A session that belongs to another wallet (the user switched accounts) is dropped.
  useEffect(() => {
    if (me?.wallet && wallet && me.wallet !== wallet) void api("/api/auth/logout", { method: "POST" }).then(() => mutate());
  }, [me?.wallet, wallet, mutate]);

  const ensureSignedIn = useCallback(async (): Promise<boolean> => {
    if (!connected || !wallet) {
      setVisible(true);
      return false;
    }
    if (me?.wallet === wallet) return true;
    if (!signMessage) throw new ApiRequestError(400, { code: "NO_SIGN_MESSAGE", message: "This wallet can't sign in. Try Phantom or Solflare.", collidesWith: null });
    inFlight.current ??= (async () => {
      try {
        const n = await api<{ nonce: string; message: string }>(`/api/auth/nonce?address=${wallet}`);
        const sig = await signMessage(new TextEncoder().encode(n.message));
        await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ address: wallet, signature: bs58.encode(sig), nonce: n.nonce }) });
        await mutate();
        return true;
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [connected, wallet, me?.wallet, signMessage, setVisible, mutate]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await mutate();
  }, [mutate]);

  return <Ctx.Provider value={{ me, ensureSignedIn, signOut, refresh: () => mutate() }}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider missing");
  return s;
}

/** A user-facing message for a failed sign-in or API call ("User rejected" stays quiet). */
export function errorText(e: unknown, fallback: string): string | null {
  if (e instanceof ApiRequestError) return e.message;
  const m = e instanceof Error ? e.message : "";
  if (/reject|cancel|denied/i.test(m)) return null;
  return fallback;
}
