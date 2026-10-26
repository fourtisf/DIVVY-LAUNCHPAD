/**
 * API calls from server components. Each one carries the visitor's IP (Nginx sets X-Real-IP), so the
 * API rate-limits visitors, not the web server: otherwise every page render shared one bucket and a
 * single busy client could take the site down (audit). Site-wide data (config, stats) is shared
 * between renders for a few seconds.
 */
import { headers } from "next/headers";
import { api, ApiRequestError } from "./api";

const shared = new Map<string, { at: number; v: Promise<unknown> }>();
const SHARED_MS = 5000;

async function visitorHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const ip = h.get("x-real-ip");
  const country = h.get("x-geo-country");
  return { ...(ip ? { "x-forwarded-for": ip } : {}), ...(country ? { "x-geo-country": country } : {}) };
}

export async function serverApi<T>(path: string): Promise<T> {
  return api<T>(path, { headers: await visitorHeaders() });
}

/** For responses that are the same for everyone (/api/config, /api/stats). */
export function sharedApi<T>(path: string): Promise<T> {
  const hit = shared.get(path);
  if (hit && Date.now() - hit.at < SHARED_MS) return hit.v as Promise<T>;
  const v = serverApi<T>(path);
  v.catch(() => shared.delete(path));
  shared.set(path, { at: Date.now(), v });
  return v;
}

/** null instead of a throw on 404. */
export async function serverApiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await serverApi<T>(path);
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}
