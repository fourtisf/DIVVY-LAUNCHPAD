"use client";

/**
 * The uspad token's contract address, in the hero next to the payout badge, from NEXT_PUBLIC_TOKEN_CA
 * (read at build time). Without one the hero shows no CA at all (owner request 2026-10-28).
 */
import { short } from "@divvy/shared";
import { Icon } from "./Icon";
import { useToast } from "./Toasts";

const raw = (process.env.NEXT_PUBLIC_TOKEN_CA ?? "").trim();
const CA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw) ? raw : "";

export function TokenCa() {
  const toast = useToast();
  if (!CA) return null;
  const copy = () => navigator.clipboard?.writeText(CA).then(() => toast("Contract address copied"), () => {});
  return (
    <button type="button" className="eyecatch ca-pill" onClick={copy} title={CA} aria-label={`Copy contract address ${CA}`}>
      <span>
        <b>CA:</b> {short(CA)}
      </span>
      <Icon name="copy" size={13} />
    </button>
  );
}
