import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import type { Config, Stats } from "@divvy/shared";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import "./additions.css";
import { sharedApi } from "@/lib/server-api";
import { BRAND } from "@/lib/brand";
import { htmlLang } from "@/i18n/lang";
import { LangProvider } from "@/i18n/client";
import { getLang, getUpDown } from "@/i18n/server";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { Strip } from "@/components/Strip";
import { TabBar } from "@/components/TabBar";
import { X_HANDLE } from "@/lib/social";

export const dynamic = "force-dynamic";

const META = {
  en: {
    title: `${BRAND}: memecoins that pay dividends in real stocks`,
    description: "Launch a memecoin on Solana. Every trade buys a real stock token and splits it between holders, every hour.",
  },
  zh: {
    title: `${BRAND}：土狗也分红，分的是美股`,
    description: "在 Solana 上免费发币。每一笔交易都会买入真实的股票代币，每小时分给所有持有人。",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(process.env.WEB_ORIGIN || "http://localhost:3000"),
    ...META[await getLang()],
    // Link cards on X credit the official account, once its handle is set (lib/social.ts).
    twitter: { card: "summary_large_image", ...(X_HANDLE ? { site: `@${X_HANDLE}`, creator: `@${X_HANDLE}` } : {}) },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#7A0C14" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [config, stats, lang, upDown] = await Promise.all([sharedApi<Config>("/api/config"), sharedApi<Stats>("/api/stats"), getLang(), getUpDown()]);
  return (
    <html lang={htmlLang(lang)} data-updown={upDown}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Design A's faces (prototype/hwai-a-prototype.html). Google splits the Han fonts by unicode-range, so a page only loads the slices it uses. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;900&family=ZCOOL+QingKe+HuangYou&family=Barlow+Condensed:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="bgpat" aria-hidden="true" />
        <LangProvider lang={lang} upDown={upDown}>
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
        </LangProvider>
      </body>
    </html>
  );
}
