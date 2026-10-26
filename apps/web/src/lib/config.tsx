"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Config, DividendAsset } from "@divvy/shared";

const Ctx = createContext<Config | null>(null);

export function ConfigProvider({ value, children }: { value: Config; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConfig(): Config {
  const c = useContext(Ctx);
  if (!c) throw new Error("ConfigProvider missing");
  return c;
}

export function useAssets(): Record<string, DividendAsset> {
  const c = useConfig();
  return Object.fromEntries(c.dividendAssets.map((a) => [a.symbol, a]));
}
