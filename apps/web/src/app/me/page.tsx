import type { Metadata } from "next";
import { MeView } from "@/components/me/MeView";
import { getMsgs } from "@/i18n/server";
import { me } from "@/i18n/msgs/me";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMsgs(me)).metaTitle };
}

export default function MePage() {
  return <MeView />;
}
