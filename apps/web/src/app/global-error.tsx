"use client";

import { LANG_COOKIE, htmlLang, parseLang } from "@/i18n/lang";
import { common } from "@/i18n/msgs/common";

/** Last resort when the root layout itself fails (e.g. /api/config is unreachable). No providers here. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const lang = parseLang(typeof document === "undefined" ? null : document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`))?.[1]);
  const t = common[lang];
  return (
    <html lang={htmlLang(lang)}>
      <body style={{ background: "#0A0F0D", color: "#EAFBF1", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <p>{t.serverDown}</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "10px 18px", borderRadius: 999, border: 0, background: "#4ADE80", color: "#03140A", fontWeight: 600, cursor: "pointer" }}>
            {t.tryAgain}
          </button>
        </div>
      </body>
    </html>
  );
}
