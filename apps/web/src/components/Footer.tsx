import Link from "next/link";

/** uspad's official X account (owner, 2026-10-27). */
export const X_HANDLE = "uspadfun";

export function Footer({ demo }: { demo: boolean }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <span>
          {demo ? "uspad prototype. Every number here is demo data." : "uspad."} Follow <a href={`https://x.com/${X_HANDLE}`} target="_blank" rel="noopener noreferrer">@{X_HANDLE}</a> on X.
        </span>
        <span>
          Tokenized stocks are issued by third parties and aren&apos;t available everywhere. Nothing here is financial advice. <Link href="/terms">Terms</Link>
        </span>
      </div>
    </footer>
  );
}
