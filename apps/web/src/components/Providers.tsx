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
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(config.network === "devnet" ? "devnet" : "mainnet-beta");
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
