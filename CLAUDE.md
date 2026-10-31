# CLAUDE.md for the Divvy repo

Read this first in every session.

## What this is
Divvy is a Solana memecoin launchpad built on Raydium LaunchLab. Every coin trades against SOL and pays its holders an hourly dividend in a tokenized stock (NVDAx, SPYx and others). The full spec is in `HANDOFF.md`. The approved UI is `prototype/hwai-a-prototype.html` (design A, 红包: red lacquer, gold and cream envelope paper; owner, 2026-10-31). It replaced `prototype/divvy-prototype.html`, the original dark green design, which stays for the record.

**Name:** the product is **hwai** (`hwai.ai`) since 2026-10-31, the owner's rebrand; they dropped the uspad name and its Koin belah logo entirely (uspad on `uspad.fun` ran from 2026-10-26; the repo is still `fourtisf/uspad`). Everything users see says hwai, with the gold square-holed coin mark (方孔钱) and the drawn "hwai" wordmark (`brand/hwai/`). The name comes from `BRAND` in `packages/shared/src/brand.ts`: web copy, API messages, the sign-in statement, alerts and new coins' metadata. The X and Telegram handles are build-time env (`NEXT_PUBLIC_X_HANDLE`, `NEXT_PUBLIC_TELEGRAM_HANDLE`; `go-live.sh socials`), so no old handle is hard-coded. Not renamed yet: the $USPAD token (waiting for the owner), the production domain (`go-live.sh domain` moves it to hwai.ai and keeps uspad.fun as a redirect) and the on-chain PlatformConfig name, web and picture (`go-live.sh platform-info`; docs/VERIFIED.md item 30), both built and waiting for the owner's run on the server. Internal names still say Divvy or uspad: the `@divvy/*` packages, `DIVVY_*` env vars, `divvy:` Redis keys, server paths like `/root/uspad-keys`, and these docs.

**Language:** the site is Chinese first (owner, 2026-10-31): Simplified Chinese by default, English with the 中 / EN switch, and an up/down colour switch in the footer: red up by default since design A (red is the brand colour, as in Chinese stock apps), green up as the option. How copy is written, the Chinese style and the glossary: `apps/web/src/i18n/README.md`.

## Stack (do not change without the owner's OK)
- **Frontend:** Next.js 15 App Router (React 19) in `apps/web`. Upgraded from 14 with the owner's OK on 2026-10-26 (docs/AUDIT.md DEP-1).
- **API:** Fastify in `apps/api`.
- **Workers:** indexer, payouts and cron in `apps/worker`.
- **Data:** Prisma with PostgreSQL in `packages/db`, plus Redis.
- **Shared code:** `packages/shared` (types, anti-vamp, fee math) and `packages/solana` (LaunchLab, Jito, Jupiter, Helius).
- **Deploy:** Hostinger VPS with PM2 and Nginx.

## Hard rules
1. **Pixel-faithful to the prototype** (`prototype/hwai-a-prototype.html`). Same tokens, fonts (ZCOOL QingKe HuangYou, Barlow Condensed, Noto Sans SC), copy, envelope hero, envelope cards, coin table and cream panels. If something looks wrong, ask; don't redesign. The prototype is one file with every page; open it and use its links.
2. **No invented on-chain facts.** Program IDs, mints, fee fields and SDK calls must be confirmed against the SDK source/IDL or on-chain data, and logged in `docs/VERIFIED.md` with the source.
3. **No mainnet spend** (PlatformConfig creation, funding wallets, test launches) without the owner's explicit approval in chat.
4. **Private keys** never go in the repo, the database, logs or client bundles. Hot wallets keep minimal balances with spend caps.
5. **The server is the authority** for anti-vamp, rate limits, amounts and fees. Client-side checks are only UI feedback.
6. **Mint addresses stay secret until the create lands.** Creates go only through Jito bundles. One exception (owner decision 2026-10-27): the creator's wallet, which signs and pays for its coin's create, sees it a few seconds early; the mint's signature never leaves the worker.
7. **The dividend engine is idempotent** (unique coin+hour) and has a dry-run mode. Run dry-run first.
8. **Copy:** sentence case, plain verbs, no all-caps labels. Keep the prototype's wording unless the owner changes it. "Paid every hour" becomes "credited every hour" only if the owner picks the claim model (HANDOFF §3.4).

## Conventions
- TypeScript strict everywhere. Use zod for API input validation.
- Amounts are integers in base units (lamports or token base units) and are serialized as strings.
- Every signed transaction is logged with its purpose and signature.
- Each phase ends with a short report: what's done, what was verified, what's blocked, and the next step.

## Commands
- `pnpm dev`: web (:3000), API (:4000) and worker in parallel. Reads the root `.env`.
- `pnpm db:migrate` (dev) / `pnpm db:deploy` (production): Prisma migrations in `packages/db`.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- Phase 0 scripts: `cd packages/solana && pnpm tsx scripts/phase0/<script>.ts` (see `docs/VERIFIED.md`). Anything that spends SOL needs `--send` and `I_HAVE_OWNER_APPROVAL=yes`.

## Where things live
- API contract (zod schemas for every §6 response): `packages/shared/src/api.ts`. The API's contract test fails on any extra or missing field.
- Anti-vamp: `packages/shared/src/antivamp.ts` and `imagehash.ts`. The API re-runs every check on launch.
- The mark in the app: `apps/web/src/components/Mark.tsx` (the gold coin; `variant="red"` on the envelope).
- Styles: `apps/web/src/app/globals.css` is the prototype's CSS verbatim (change both together); `additions.css` holds what the prototype doesn't draw (modals, toasts, admin, the wallet picker) and maps the app's own class names onto the prototype's look.
- Copy in both languages: `apps/web/src/i18n/msgs/` (one file per area, `defineMsgs(en, zh)`); English stays the prototype's wording.
