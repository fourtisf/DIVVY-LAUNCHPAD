import Link from "next/link";
import { TELEGRAM_URL, X_HANDLE, X_URL } from "@/lib/social";

export function Footer({ demo }: { demo: boolean }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <span>
          {demo ? "uspad prototype. Every number here is demo data." : "uspad."} Follow <a href={X_URL} target="_blank" rel="noopener noreferrer">@{X_HANDLE}</a> on X and join us on{" "}
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">Telegram</a>.
        </span>
        <span>
          Tokenized stocks are issued by third parties and aren&apos;t available everywhere. Nothing here is financial advice. <Link href="/terms">Terms</Link>
        </span>
      </div>
    </footer>
  );
}
