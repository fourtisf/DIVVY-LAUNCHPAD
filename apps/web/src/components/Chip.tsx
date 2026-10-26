"use client";

import { useAssets } from "@/lib/config";
import { stockLogo } from "@/lib/logos";

/** Round stock chip (prototype `chip`): the token's own icon, or its initials when there's none. */
export function Chip({ sym }: { sym: string }) {
  const a = useAssets()[sym];
  const logo = stockLogo(sym);
  if (logo) {
    return (
      <span className="chip-stock chip-logo" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }
  const mono = a?.mono ?? sym.slice(0, 2);
  return (
    <span className={"chip-stock" + (mono.length > 2 ? " m3" : "")} style={{ background: a?.chipBg, color: a?.chipFg }} aria-hidden="true">
      {mono}
    </span>
  );
}
