/**
 * The official X and Telegram accounts, set at build time (NEXT_PUBLIC_X_HANDLE, NEXT_PUBLIC_TELEGRAM_HANDLE;
 * on the server `go-live.sh socials <x> <telegram>`). The owner dropped the uspad name on 2026-10-31, so
 * nothing is hard-coded: while a handle is unset, its pill, footer link and X card credit don't show.
 */
const handle = (v: string | undefined): string => {
  const h = (v ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,32}$/.test(h) ? h : "";
};

export const X_HANDLE = handle(process.env.NEXT_PUBLIC_X_HANDLE);
export const X_URL = X_HANDLE ? `https://x.com/${X_HANDLE}` : "";

export const TELEGRAM_HANDLE = handle(process.env.NEXT_PUBLIC_TELEGRAM_HANDLE);
export const TELEGRAM_URL = TELEGRAM_HANDLE ? `https://t.me/${TELEGRAM_HANDLE}` : "";
