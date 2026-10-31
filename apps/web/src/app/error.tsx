"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "@/components/Icon";
import { useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";

/** Any page that throws (e.g. the API is down) shows this instead of a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useMsgs(common);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <>
      <Link className="back" href="/"><Icon name="back" />{t.backToBoard}</Link>
      <div className="empty">
        {t.errorLoading}{" "}
        <button className="link" type="button" onClick={reset} style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}>
          {t.tryAgain}
        </button>
        {t.period}
      </div>
    </>
  );
}
