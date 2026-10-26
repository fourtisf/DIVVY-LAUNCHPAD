# Board load test (HANDOFF Phase 5)

Target: 1,000 coins, 50 requests per second on the board's real requests, live API (Postgres + Redis).

```bash
# 1. A throwaway database (its name must contain "load"; the seed truncates it)
cd packages/db
LOAD_DATABASE_URL=postgresql://divvy:divvy@localhost:5432/divvy_load?schema=public
DATABASE_URL=$LOAD_DATABASE_URL node ./node_modules/prisma/build/index.js migrate deploy
NODE_PATH=$PWD/node_modules:../solana/node_modules LOAD_DATABASE_URL=$LOAD_DATABASE_URL node ../../scripts/loadtest/seed.cjs

# 2. A SOL price in Redis (the board needs one), then the API in live mode on :4100
redis-cli set divvy:prices '{"solUsd":150,"byMint":{},"change24h":{},"at":1}' EX 3600
cd ../../apps/api
API_MODE=live API_PORT=4100 LOG_LEVEL=warn DATABASE_URL=$LOAD_DATABASE_URL REDIS_URL=redis://localhost:6379 \
  SOLANA_CLUSTER=devnet SOLANA_RPC_URL=https://rpc.invalid DIVVY_PLATFORM_CONFIG=<any pubkey> \
  STORAGE_DIR=/tmp/loadmedia PUBLIC_MEDIA_BASE=http://localhost:3000/api/media/files node --import tsx src/server.ts &

# 3. Load: open loop, many client IPs (X-Forwarded-For, as behind Nginx)
RPS=50 DUR=60 node ../../scripts/loadtest/load.mjs
RPS=200 DUR=20 node ../../scripts/loadtest/load.mjs
```

Result on 2026-10-26 (single API process, local Postgres 16 and Redis 7):

| Load | Requests | Errors | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|
| 50 req/s, 60 s | 3,000 | 0 | 2.1 ms | 8.6 ms | 155 ms | 265 ms |
| 200 req/s, 20 s, after the single-flight board cache | 4,000 | 0 | 1.8 ms | 3.6 ms | 6.2 ms | 42 ms |

Before the board cache refresh was made single-flight, 200 req/s gave p99 1.05 s (every request that
found the cache stale ran its own 1,000-row query).
