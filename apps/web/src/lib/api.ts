/**
 * Typed access to the Divvy API (HANDOFF §6). Browser calls are same-origin (/api/*, proxied by Next
 * in dev and Nginx in production); server components call the API directly.
 */
import type { ApiError } from "@divvy/shared";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

const base = (): string => (typeof window === "undefined" ? process.env.API_INTERNAL_URL || "http://127.0.0.1:4000" : "");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base() + path, {
    ...init,
    headers: { ...(init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}), ...init?.headers },
    cache: "no-store",
    credentials: "same-origin",
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiRequestError(res.status, (body as ApiError) ?? null);
  return body as T;
}

/** For server components: null instead of a throw on 404. */
export async function apiOrNull<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}

export const fetcher = <T,>(path: string) => api<T>(path);

export const qs = (o: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};
