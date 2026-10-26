import Link from "next/link";

export function Footer({ demo }: { demo: boolean }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <span>{demo ? "Divvy prototype. Every number here is demo data." : "Divvy"}</span>
        <span>
          Tokenized stocks are issued by third parties and aren&apos;t available everywhere. Nothing here is financial advice. <Link href="/terms">Terms</Link>
        </span>
      </div>
    </footer>
  );
}
