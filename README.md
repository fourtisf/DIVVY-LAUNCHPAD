# Divvy

A Solana memecoin launchpad on Raydium LaunchLab where every coin pays its holders an hourly dividend in a tokenized stock (NVDAx, SPYx and others), while the coin itself trades against SOL.

- Spec: [`HANDOFF.md`](HANDOFF.md). Repo rules: [`CLAUDE.md`](CLAUDE.md). Approved UI: [`prototype/divvy-prototype.html`](prototype/divvy-prototype.html).
- What's been checked against Raydium/Jito/Jupiter sources: [`docs/VERIFIED.md`](docs/VERIFIED.md).

## Layout

```
apps/web         Next.js 15 (App Router): /, /coin/[ticker], /create, /payouts, /how
apps/api         Fastify API (HANDOFF §6). API_MODE=mock serves deterministic demo data.
apps/worker      Cron: hourly payouts (dry-run by default), daily reserved tickers, indexer heartbeat
packages/db      Prisma schema + migrations (PostgreSQL)
packages/shared  API contract (zod), anti-vamp folding and checks, pHash, fee math, formatters
packages/solana  Verified program IDs, curve helpers, Phase 0 scripts (scripts/phase0)
```

## Run it locally

Needs Node 22, pnpm 10, PostgreSQL 16 and Redis 7 (`docker compose up -d` starts both).

```bash
cp .env.example .env
pnpm install
pnpm db:migrate        # applies packages/db/prisma/migrations
pnpm dev               # web :3000, API :4000, worker
```

The web app calls the API on the same origin (`/api/*`): Next proxies it in development, Nginx in production.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Web, API and worker in parallel |
| `pnpm build` | Production builds (Next.js, tsup bundles for API and worker) |
| `pnpm test` | Unit and contract tests (Vitest) |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm lint` | ESLint over the repo |
| `pnpm db:migrate` / `pnpm db:deploy` | Prisma migrate (dev / production) |

## Status

Phase 0 (verification) and Phase 1 (scaffold, UI port, mock API, schema) are done. Every number in the app is still demo data from the mock API; the footer says so. Nothing has been sent on chain.
