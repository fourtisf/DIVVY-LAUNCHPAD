import type { Metadata } from "next";
import { MeView } from "@/components/me/MeView";

export const metadata: Metadata = { title: "Your payouts · Divvy" };

export default function MePage() {
  return <MeView />;
}
