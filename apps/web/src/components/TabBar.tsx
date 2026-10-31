"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";
import { Icon } from "./Icon";
import { navOf } from "./Header";

export function TabBar() {
  const nav = navOf(usePathname());
  const t = useMsgs(common);
  const cur = (k: string) => (nav === k ? { "aria-current": "page" as const } : {});
  return (
    <nav className="tabbar" aria-label="Mobile">
      <Link href="/" {...cur("board")}>
        <span><Icon name="home" size={20} /></span>{t.tabBoard}
      </Link>
      <Link href="/create" className="mk" {...cur("create")}>
        <span className="plus"><Icon name="plus" size={20} /></span>{t.tabCreate}
      </Link>
      <Link href="/payouts" {...cur("payouts")}>
        <span><Icon name="receipt" size={20} /></span>{t.tabPayouts}
      </Link>
      <Link href="/how" {...cur("how")}>
        <span><Icon name="book" size={20} /></span>{t.tabHow}
      </Link>
    </nav>
  );
}
