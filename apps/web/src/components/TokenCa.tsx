"use client";

/**
 * The platform token's contract address ($USPAD, launched before the hwai rename), in the hero next to the payout badge, from NEXT_PUBLIC_TOKEN_CA
 * (read at build time). Without one it says "coming soon" (owner request 2026-10-28).
 */
import { short } from "@divvy/shared";
import { Icon } from "./Icon";
import { useToast } from "./Toasts";
import { useMsgs } from "@/i18n/client";
import { hero } from "@/i18n/msgs/hero";

const raw = (process.env.NEXT_PUBLIC_TOKEN_CA ?? "").trim();
const CA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw) ? raw : "";

export function TokenCa() {
  const toast = useToast();
  const t = useMsgs(hero);
  if (!CA) {
    return (
      <span className="eyecatch ca-pill">
        <span>
          <b>CA:</b> {t.caSoon}
        </span>
      </span>
    );
  }
  const copy = () => navigator.clipboard?.writeText(CA).then(() => toast(t.caCopied), () => {});
  return (
    <button type="button" className="eyecatch ca-pill" onClick={copy} title={CA} aria-label={t.copyCa(CA)}>
      <span>
        <b>CA:</b> {short(CA)}
      </span>
      <Icon name="copy" size={13} />
    </button>
  );
}
