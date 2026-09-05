// Worker entry: serves the built SPA from [assets] and provides a small
// same-origin title API so the client can label scanned URLs without hitting
// browser CORS limits (most sites, YouTube included, don't send CORS headers
// to third-party origins).

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const TITLE_TIMEOUT_MS = 6000;
const MAX_BYTES = 80_000; // <title>/og:title always live in the head

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/title') {
      return handleTitle(request, url);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function isBlockedHost(hostname: string): boolean {
  return (
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i.test(hostname) ||
    /\.local$/i.test(hostname) ||
    hostname === 'metadata.google.internal'
  );
}

async function handleTitle(request: Request, url: URL): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  const target = url.searchParams.get('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return Response.json({ error: 'invalid url' }, { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Response.json({ error: 'unsupported scheme' }, { status: 400 });
  }
  // SSRF guard: the endpoint fetches arbitrary URLs, so keep it away from
  // loopback/private ranges and cloud metadata endpoints.
  if (isBlockedHost(parsed.hostname)) {
    return Response.json({ error: 'blocked host' }, { status: 403 });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
    const res = await fetch(parsed.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some sites 403 unknown clients; a browser-ish UA works for most.
        'user-agent':
          'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return Response.json({ error: 'upstream status' }, { status: 502 });
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return Response.json({ error: 'no body' }, { status: 502 });
    }
    let text = '';
    const decoder = new TextDecoder();
    while (text.length < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(text)) break;
    }
    reader.cancel().catch(() => {});

    // Prefer <title>, fall back to og:title / twitter:title.
    let title =
      text.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] ??
      text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i)?.[1] ??
      text.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:title["']/i)?.[1] ??
      '';
    title = title.replace(/\s+/g, ' ').trim();

    // YouTube watch URLs: the HTML <title> is just "YouTube" (SPA shell).
    // Their public oEmbed API returns the real video title.
    const yt = parsed.hostname.match(/(^|\.)youtube\.com$/i) || parsed.hostname === 'youtu.be';
    if (yt && /\/(watch|shorts)\//.test(parsed.pathname) && (!title || /^youtube$/i.test(title))) {
      const oembed = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.href)}&format=json`,
      ).catch((e) => { console.log('[title] oembed fetch error:', String(e)); return null; });
      if (oembed && oembed.ok) {
        const data = (await oembed.json().catch(() => null)) as { title?: string } | null;
        if (data?.title) title = data.title;
      }
    }

    if (!title) {
      return Response.json({ error: 'no title' }, { status: 404 });
    }
    return Response.json(
      { title },
      { headers: { 'cache-control': 'public, max-age=86400' } },
    );
  } catch {
    return Response.json({ error: 'fetch failed' }, { status: 502 });
  }
}
