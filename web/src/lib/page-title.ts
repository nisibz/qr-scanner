// Fetches a human-readable title for scanned URLs via our own Worker
// (/api/title) — browser-side fetches are blocked by CORS on most sites
// (YouTube included), so the Worker proxies the fetch server-side where
// CORS doesn't apply. Private/loopback hosts are rejected by the Worker
// (SSRF guard) and never leave useful data anyway.

const TIMEOUT_MS = 6000;

/**
 * Best-effort page title for a URL. Returns undefined when the Worker can't
 * provide one (blocked host, upstream error, no <title> found).
 */
export async function fetchPageTitle(url: string): Promise<string | undefined> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`/api/title?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { title?: string };
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    return title || undefined;
  } catch {
    return undefined;
  }
}
