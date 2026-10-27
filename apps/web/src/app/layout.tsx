import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import type { Config, Stats } from "@divvy/shared";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import "./additions.css";
import { sharedApi } from "@/lib/server-api";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { Strip } from "@/components/Strip";
import { TabBar } from "@/components/TabBar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_ORIGIN || "http://localhost:3000"),
  title: "uspad: memecoins that pay dividends in real stocks",
  description: "Launch a memecoin on Solana. Every trade buys a real stock token and splits it between holders, every hour.",
  // Link cards on X credit the official account.
  twitter: { card: "summary_large_image", site: "@uspadfun", creator: "@uspadfun" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0A0F0D" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [config, stats] = await Promise.all([sharedApi<Config>("/api/config"), sharedApi<Stats>("/api/stats")]);
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&f[]=satoshi@400,500,700&display=swap" rel="stylesheet" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers config={config}>
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          <Strip events={stats.activity} />
          <main id="app" className="wrap">
            {children}
          </main>
          <Footer demo={config.demo} />
          <TabBar />
        </Providers>
      </body>
    </html>
  );
}
