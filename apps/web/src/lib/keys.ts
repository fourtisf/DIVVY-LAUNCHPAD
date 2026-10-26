import type { CoinSort } from "@divvy/shared";
import { qs } from "./api";

/** SWR key (and server fetch path) for the board grid. */
export const coinsKey = (o: { sort: CoinSort; pays: string; q: string }) =>
  "/api/coins" + qs({ sort: o.sort, pays: o.pays === "all" ? null : o.pays, q: o.q.trim(), limit: 100 });
