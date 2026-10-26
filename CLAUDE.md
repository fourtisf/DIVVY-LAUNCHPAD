# CLAUDE.md for the Divvy repo

Read this first in every session.

## What this is
Divvy is a Solana memecoin launchpad built on Raydium LaunchLab. Every coin trades against SOL and pays its holders an hourly dividend in a tokenized stock (NVDAx, SPYx and others). The full spec is in `HANDOFF.md`. The approved UI is `prototype/divvy-prototype.html`.

## Stack (do not change without the owner's OK)
- **Frontend:** Next.js 14 App Router in `apps/web`.
- **API:** Fastify in `apps/api`.
- **Workers:** indexer, payouts and cron in `apps/worker`.
- **Data:** Prisma with PostgreSQL in `packages/db`, plus Redis.
- **Shared code:** `packages/shared` (types, anti-vamp, fee math) and `packages/solana` (LaunchLab, Jito, Jupiter, Helius).
- **Deploy:** Hostinger VPS with PM2 and Nginx.

## Hard rules
1. **Pixel-faithful to the prototype.** Same tokens, fonts, copy, 3D coins, tilt cards and coupon stubs. If something looks wrong, ask; don't redesign.
2. **No invented on-chain facts.** Program IDs, mints, fee fields and SDK calls must be confirmed against the SDK source/IDL or on-chain data, and logged in `docs/VERIFIED.md` with the source.
3. **No mainnet spend** (PlatformConfig creation, funding wallets, test launches) without the owner's explicit approval in chat.
4. **Private keys** never go in the repo, the database, logs or client bundles. Hot wallets keep minimal balances with spend caps.
5. **The server is the authority** for anti-vamp, rate limits, amounts and fees. Client-side checks are only UI feedback.
6. **Mint addresses stay secret until the create lands.** Creates go only through Jito bundles.
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
- 3D coins: `apps/web/src/three/scenes.ts` (`three@0.128.0`, same as the prototype's r128), loaded with a dynamic import from `apps/web/src/components/Coin3D.tsx`.
- Styles: `apps/web/src/app/globals.css` is the prototype's CSS verbatim; anything new goes in `additions.css`.
