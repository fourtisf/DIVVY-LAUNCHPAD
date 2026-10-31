import Link from "next/link";
import { Icon } from "@/components/Icon";
import { getMsgs } from "@/i18n/server";
import { common } from "@/i18n/msgs/common";

export default async function NotFound() {
  const t = await getMsgs(common);
  return (
    <>
      <Link className="back" href="/"><Icon name="back" />{t.backToBoard}</Link>
      <div className="empty">{t.notFound}</div>
    </>
  );
}
