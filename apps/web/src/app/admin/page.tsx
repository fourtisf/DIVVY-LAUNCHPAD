import type { Metadata } from "next";
import { AdminView } from "@/components/admin/AdminView";

export const metadata: Metadata = { title: "Admin · Divvy", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <AdminView />;
}
