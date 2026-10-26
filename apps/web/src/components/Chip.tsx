"use client";

import { useAssets } from "@/lib/config";

/** Round stock chip (prototype `chip`). */
export function Chip({ sym }: { sym: string }) {
  const a = useAssets()[sym];
  const mono = a?.mono ?? sym.slice(0, 2);
  return (
    <span className={"chip-stock" + (mono.length > 2 ? " m3" : "")} style={{ background: a?.chipBg, color: a?.chipFg }} aria-hidden="true">
      {mono}
    </span>
  );
}
