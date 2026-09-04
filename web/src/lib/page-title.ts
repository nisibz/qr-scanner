// Fetches a human-readable title for scanned URLs so history rows read as
// "Article title" instead of a bare domain. Strict limits: only http(s),
// 4s timeout, small text budget — a failure just leaves the title unset and
// the row falls back to domain/path display. Nothing is fetched for other
// QR types, and no page content is stored beyond the <title> string.

const TIMEOUT_MS = 4000;
const MAX_BYTES = 60_000; // <title> lives in <head>; no need for more

/**
 * Best-effort page title for a URL. Returns undefined when the URL isn't
 * fetchable (local IPs, non-http schemes, network error, no <title> found).
 */
export async function fetchPageTitle(url: string): Promise<string | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  // Never fetch loopback/private-looking hosts — scanning a router URL
  // shouldn't make the phone talk to it.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(parsed.hostname)) return undefined;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const reader = res.body?.getReader();
    if (!reader) return undefined;
    let text = '';
    const decoder = new TextDecoder();
    while (text.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      // Early exit once <title> is complete and closed.
      if (/<\/title>/i.test(text)) break;
    }
    reader.cancel().catch(() => {});
    const m = text.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
    if (!m) return undefined;
    const title = m[1].replace(/\s+/g, ' ').trim();
    return title || undefined;
  } catch {
    return undefined;
  }
}
