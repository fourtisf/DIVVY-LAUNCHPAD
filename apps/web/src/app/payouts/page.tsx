import type { PayoutList, Stats } from "@divvy/shared";
import { api } from "@/lib/api";
import { PayoutsView } from "@/components/payouts/PayoutsView";

export default async function PayoutsPage() {
  const [list, stats] = await Promise.all([api<PayoutList>("/api/payouts?limit=60"), api<Stats>("/api/stats")]);
  return <PayoutsView initial={list} assetsInUse={stats.assetsInUse} nextRoundAt={stats.nextRoundAt} />;
}
