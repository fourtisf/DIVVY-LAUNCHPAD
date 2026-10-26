import type { PayoutList, Stats } from "@divvy/shared";
import { serverApi, sharedApi } from "@/lib/server-api";
import { PayoutsView } from "@/components/payouts/PayoutsView";

export default async function PayoutsPage() {
  const [list, stats] = await Promise.all([serverApi<PayoutList>("/api/payouts?limit=60"), sharedApi<Stats>("/api/stats")]);
  return <PayoutsView initial={list} assetsInUse={stats.assetsInUse} nextRoundAt={stats.nextRoundAt} />;
}
