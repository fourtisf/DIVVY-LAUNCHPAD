"use client";

/**
 * Sign-in with Solana (HANDOFF §6): the API hands out a single-use nonce message, the wallet signs it,
 * and the API sets an httpOnly session cookie. Sign-in only happens when an action needs it
 * (uploading, launching, claiming), never on connect.
 *
 * Wallets with `signIn` render the message themselves and check its domain against the page (audit).
 * Others sign the message as text, after this page checks it names this site and this wallet.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import useSWR from "swr";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import type { Me, NonceResponse } from "@divvy/shared";
import { api, ApiRequestError } from "./api";
import { FailedOnChain, SentUnconfirmed, TxExpired } from "./tx";
import { UnsafeTransaction } from "./txcheck";
import type { Lang } from "@/i18n/lang";
import { useLang } from "@/i18n/client";
import { txErrors } from "@/i18n/msgs/errors";

interface Session {
  me: Me | undefined;
  /** Resolves true once the connected wallet has a session; prompts to connect or sign if needed. */
  ensureSignedIn(): Promise<boolean>;
  signOut(): Promise<void>;
  refresh(): Promise<unknown>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, signIn, connected } = useWallet();
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
    if (!signIn && !signMessage) throw new ApiRequestError(400, { code: "NO_SIGN_MESSAGE", message: "This wallet can't sign in. Try Phantom or Solflare.", collidesWith: null });
    const nonce = () => api<NonceResponse>(`/api/auth/nonce?address=${wallet}`);
    const verify = (nonce: string, signature: Uint8Array, signedMessage?: Uint8Array) =>
      api("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ address: wallet, signature: bs58.encode(signature), nonce, ...(signedMessage ? { signedMessage: toBase64(signedMessage) } : {}) }),
      });
    inFlight.current ??= (async () => {
      try {
        let done = false;
        if (signIn) {
          const n = await nonce();
          const out = await signIn(n.input);
          if (out.account.address !== wallet) throw new ApiRequestError(400, { code: "WRONG_ACCOUNT", message: "Your wallet signed in with a different account. Switch to the connected one and try again.", collidesWith: null });
          try {
            await verify(n.nonce, out.signature, out.signedMessage);
            done = true;
          } catch (e) {
            // A wallet that renders the message its own way: fall back to signing the text.
            if (!(e instanceof ApiRequestError && e.body?.code === "SIGN_IN_MISMATCH" && signMessage)) throw e;
          }
        }
        if (!done) {
          const n = await nonce();
          if (!n.message.startsWith(`${window.location.host} wants you to sign in with your Solana account:\n${wallet}\n`)) {
            throw new ApiRequestError(400, { code: "BAD_MESSAGE", message: "The sign-in message doesn't name this site. Nothing was signed.", collidesWith: null });
          }
          await verify(n.nonce, await signMessage!(new TextEncoder().encode(n.message)));
        }
        await mutate();
        return true;
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, [connected, wallet, me?.wallet, signIn, signMessage, setVisible, mutate]);

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

function toBase64(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s);
}

/**
 * A user-facing message for a failed sign-in or API call ("User rejected" stays quiet), in `lang`.
 * The API's own messages are in English and are shown as they are. In components, useErrorText().
 */
export function errorText(e: unknown, fallback: string, lang: Lang = "en"): string | null {
  if (e instanceof ApiRequestError) return e.message;
  const t = txErrors[lang];
  if (e instanceof UnsafeTransaction) return t.unsafe(e.reason);
  if (e instanceof SentUnconfirmed) return t.sentUnconfirmed;
  if (e instanceof TxExpired) return t.expired;
  if (e instanceof FailedOnChain) return t.failedOnChain;
  const m = e instanceof Error ? e.message : "";
  if (m === txErrors.en.noWallet) return t.noWallet;
  if (m === txErrors.en.cantSign) return t.cantSign;
  if (/reject|cancel|denied/i.test(m)) return null;
  return fallback;
}

/** errorText in the visitor's language. */
export function useErrorText(): (e: unknown, fallback: string) => string | null {
  const [lang] = useLang();
  return (e, fallback) => errorText(e, fallback, lang);
}
