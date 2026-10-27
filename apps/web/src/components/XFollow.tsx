import { TELEGRAM_HANDLE, TELEGRAM_URL, X_HANDLE, X_URL } from "@/lib/social";

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

/** The Telegram paper plane, filled like the X logo. */
export function TelegramLogo({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M21.5 3.5 2.6 10.8c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.8 5.6c.2.7 1.1.9 1.6.4l2.6-2.5 4.7 3.5c.6.4 1.4.1 1.5-.6L22.9 4.7c.2-.8-.6-1.5-1.4-1.2zM9.5 14.6l-.4 3.6-1.3-4.1 9.8-6.5z" />
    </svg>
  );
}

/** "Join @uspadfun" on Telegram, next to the X pill. */
export function TelegramJoin() {
  return (
    <a className="eyecatch ca-pill x-pill" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label={`Join @${TELEGRAM_HANDLE} on Telegram`}>
      <TelegramLogo />
      <span>
        Join <b>@{TELEGRAM_HANDLE}</b>
      </span>
    </a>
  );
}
