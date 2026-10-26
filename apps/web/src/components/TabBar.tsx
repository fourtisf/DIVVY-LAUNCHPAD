"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { navOf } from "./Header";

export function TabBar() {
  const nav = navOf(usePathname());
  const cur = (k: string) => (nav === k ? { "aria-current": "page" as const } : {});
  return (
    <nav className="tabbar" aria-label="Mobile">
      <Link href="/" {...cur("board")}>
        <span><Icon name="home" size={20} /></span>Board
      </Link>
      <Link href="/create" className="mk" {...cur("create")}>
        <span className="plus"><Icon name="plus" size={20} /></span>Create
      </Link>
      <Link href="/payouts" {...cur("payouts")}>
        <span><Icon name="receipt" size={20} /></span>Payouts
      </Link>
      <Link href="/how" {...cur("how")}>
        <span><Icon name="book" size={20} /></span>How
      </Link>
    </nav>
  );
}
