import Link from "next/link";
import { TELEGRAM_HANDLE, TELEGRAM_URL, X_HANDLE, X_URL } from "@/lib/social";
import { getMsgs } from "@/i18n/server";
import { common } from "@/i18n/msgs/common";
import { UpDownSwitch } from "./UpDownSwitch";

export async function Footer({ demo }: { demo: boolean }) {
  const t = await getMsgs(common);
  return (
    <footer className="foot">
      <div className="wrap">
        <span>
          {demo ? t.footDemo : t.footLive}
          {/* Each account shows once its handle is set (lib/social.ts). */}
          {X_HANDLE && (
            <>
              {" "}
              {t.footFollow} <a href={X_URL} target="_blank" rel="noopener noreferrer">@{X_HANDLE}</a> {TELEGRAM_HANDLE ? t.footOnX : t.footOnXEnd}
            </>
          )}
          {TELEGRAM_HANDLE && (
            <>
              {" "}
              {X_HANDLE ? "" : `${t.footJoin} `}
              <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">Telegram</a>
              {t.footEnd}
            </>
          )}
        </span>
        <span>
          {t.footStocks} <Link href="/terms">{t.terms}</Link>
        </span>
        <UpDownSwitch />
      </div>
    </footer>
  );
}
