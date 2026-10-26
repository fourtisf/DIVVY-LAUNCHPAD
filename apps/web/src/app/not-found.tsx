import Link from "next/link";
import { Icon } from "@/components/Icon";

export default function NotFound() {
  return (
    <>
      <Link className="back" href="/"><Icon name="back" />Back to the board</Link>
      <div className="empty">This page doesn&apos;t exist.</div>
    </>
  );
}
