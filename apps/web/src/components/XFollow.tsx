import { X_HANDLE, X_URL } from "@/lib/social";

/** The X logo (a filled glyph, unlike the stroked icons in Icon.tsx). */
export function XLogo({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** "Follow @uspadfun" in the hero, next to the contract address badge. */
export function XFollow() {
  return (
    <a className="eyecatch ca-pill x-pill" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label={`Follow @${X_HANDLE} on X`}>
      <XLogo />
      <span>
        Follow <b>@{X_HANDLE}</b>
      </span>
    </a>
  );
}
