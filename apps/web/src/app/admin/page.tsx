import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { Me } from "@divvy/shared";
import { AdminView } from "@/components/admin/AdminView";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "Admin · uspad", robots: { index: false, follow: false } };

/**
 * Hidden (owner request 2026-10-28): anyone but a signed-in admin gets the site's plain 404, and nothing
 * links here. An admin signs in on /me with an ADMIN_WALLETS wallet, then opens /admin by hand. The API
 * checks every admin call on its own.
 */
export default async function AdminPage() {
  const session = (await cookies()).get("divvy_session")?.value;
  if (!session) notFound();
  const me = await serverApi<Me>("/api/me", { cookie: `divvy_session=${encodeURIComponent(session)}` }).catch(() => null);
  if (!me?.isAdmin) notFound();
  return <AdminView />;
}
