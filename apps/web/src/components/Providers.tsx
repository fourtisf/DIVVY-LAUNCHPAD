"use client";

import { useMemo, type ReactNode } from "react";
import { SWRConfig } from "swr";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import type { Config } from "@divvy/shared";
import { fetcher } from "@/lib/api";
import { ConfigProvider } from "@/lib/config";
import { SessionProvider } from "@/lib/session";
import { TiltController } from "./Tilt";
import { ToastProvider } from "./Toasts";

/**
 * Wallets: Phantom and Solflare adapters, plus every Wallet Standard wallet the browser exposes
 * (Backpack registers itself that way, as do current Phantom and Solflare builds).
 */
export function Providers({ config, children }: { config: Config; children: ReactNode }) {
  // A path is uspad's own RPC relay (/api/rpc, apps/api/src/live/routes/rpc.ts); web3.js needs it absolute.
  // On the server nothing is sent, so any origin will do there.
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  const endpoint = rpc?.startsWith("/")
    ? `${typeof window === "undefined" ? "http://localhost" : window.location.origin}${rpc}`
    : rpc || clusterApiUrl(config.network === "devnet" ? "devnet" : "mainnet-beta");
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConfigProvider value={config}>
      <SWRConfig value={{ fetcher, revalidateOnFocus: false, keepPreviousData: true }}>
        <ConnectionProvider endpoint={endpoint}>
          <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>
              <SessionProvider>
                <ToastProvider>
                  <TiltController />
                  {children}
                </ToastProvider>
              </SessionProvider>
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </SWRConfig>
    </ConfigProvider>
  );
}
