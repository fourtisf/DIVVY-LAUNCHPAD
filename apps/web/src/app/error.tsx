"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "@/components/Icon";

/** Any page that throws (e.g. the API is down) shows this instead of a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <>
      <Link className="back" href="/"><Icon name="back" />Back to the board</Link>
      <div className="empty">
        Something went wrong loading this page.{" "}
        <button className="link" type="button" onClick={reset} style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}>
          Try again
        </button>
        .
      </div>
    </>
  );
}
