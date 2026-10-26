# Prompt for Claude Code (copy everything below the line)

---

You're the lead engineer building **Divvy**, a Solana memecoin launchpad on Raydium LaunchLab where every coin pays its holders an hourly dividend in a tokenized stock (NVDAx, SPYx, etc.), while the coin itself always trades against SOL.

The repo contains:
- `HANDOFF.md`: the full spec (mechanics, on-chain design, API, data model, workers, security, phases). This is the source of truth for behaviour.
- `CLAUDE.md`: the hard rules for this repo. Follow them in every session.
- `prototype/divvy-prototype.html`: the owner-approved UI, a single file with mock data. This is the source of truth for look, copy and interactions, including the three.js 3D coins, the tilt cards and the green Clash Display/Satoshi theme.

Read all three files fully before writing any code. Then work phase by phase, as defined in HANDOFF §11.

**Start now with Phase 0 and Phase 1 together:**

1. **Phase 0 (verify).** Create `docs/VERIFIED.md`. Using the `@raydium-io/raydium-sdk-v2` source/IDL, Raydium's LaunchLab docs and on-chain data, confirm every item marked VERIFY in HANDOFF.md:
   - The LaunchLab create params for a Token-2022 standard coin with no transfer fee and quote SOL.
   - The PlatformConfig fee fields and caps, and whether the protocol fee is inside or on top.
   - Whether the creator account must sign.
   - How platform fees are claimed per pool.
   - How locked-LP and Fee Key fees are claimed after graduation.
   - The curve supply and graduation numbers.
   - Jito bundle submission.
   - Jupiter swaps from SOL into xStocks mints.

   For each item, write what you found and the exact source (file and line, doc URL, or tx signature). Write scripts for anything that needs an on-chain test, but **don't run anything that spends mainnet SOL. Stop and ask me first.**

2. **Phase 1 (scaffold and UI port).** Set up the pnpm monorepo from HANDOFF §11 (`apps/web`, `apps/api`, `apps/worker`, `packages/db`, `packages/shared`, `packages/solana`) on Next.js 14, Fastify, Prisma/PostgreSQL and Redis.
   - Port the prototype into Next.js pages `/`, `/coin/[ticker]`, `/create`, `/payouts` and `/how`, pixel-close at 1440px and 390px.
   - Move the 3D coin code to client-only components (dynamic import, `three` from npm), with the same materials, lighting, environment map, animations, off-screen pausing, reduced-motion handling and WebGL fallback.
   - Move the anti-vamp fold and check functions into `packages/shared` with unit tests, covering leetspeak, Cyrillic homoglyphs, "official/2" names and the 8×8 pHash Hamming distance.
   - Build a mock Fastify API that returns exactly the shapes in HANDOFF §6, so the frontend has no hard-coded data left.
   - Add the Prisma schema from HANDOFF §7 and run the first migration.

When Phase 0 and Phase 1 are done, stop and send me a short report:
- what's built,
- what you verified (with sources),
- anything that contradicts HANDOFF.md,
- the open decisions I need to make (HANDOFF §12),
- what you'll do in Phase 2.

Don't start Phase 2 until I reply.
