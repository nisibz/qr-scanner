// Smart content-type detection for decoded QR text.
//
// `parseResult(text)` returns a ParsedResult describing the kind of payload,
// human-readable fields to show, and a list of UI actions to offer.
// The parser is UI-agnostic — the orchestrator decides how to render.

const RE_URL = /^([a-z][a-z0-9+.\-]*:)?\/\/[^\s]+$/i;
const RE_HTTP_URL = /^https?:\/\/[^\s]+$/i;
const RE_MAILTO = /^mailto:/i;
const RE_TEL = /^tel:/i;
const RE_SMS = /^(sms|smsto):/i;
const RE_GEO = /^geo:/i;
const RE_WIFI = /^WIFI:/i;
const RE_VCARD_BEGIN = /^BEGIN:VCARD/im;
const RE_VEVENT_BEGIN = /^BEGIN:VEVENT/im;
const RE_MECARD = /^MECARD:/i;
const RE_BARE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const RE_BTC = /^(bitcoin|bitcoincash|bc1):/i;
const RE_ETH = /^ethereum:0x[0-9a-f]{40}$/i;

/**
 * @typedef {Object} Field
 * @property {string} label
 * @property {string} value
 * @property {boolean} [monospace]
 *
 * @typedef {Object} Action
 * @property {'link'|'copy'|'download'} kind
 * @property {string} label
 * @property {string} [href]        // for 'link'
 * @property {string} [value]       // for 'copy'
 * @property {string} [filename]    // for 'download'
 * @property {string} [content]     // for 'download'
 * @property {string} [mime]        // for 'download'
 * @property {boolean} [primary]    // visually emphasized
 *
 * @typedef {Object} ParsedResult
 * @property {string} type
 * @property {string} label         // uppercase UI badge
 * @property {string} title         // main display text
 * @property {Field[]} fields
 * @property {Action[]} actions
 * @property {{ isSafe: boolean, reasons: string[] }} [safety]   // URLs only
 * @property {string} raw           // original decoded text
 */

/** @returns {ParsedResult} */
export function parseResult(raw) {
  const text = (raw || '').trim();
  if (!text) return { type: 'empty', label: '', title: '', fields: [], actions: [], raw: '' };

  if (RE_WIFI.test(text)) return parseWifi(text);
  if (RE_VCARD_BEGIN.test(text)) return parseVCard(text);
  if (RE_VEVENT_BEGIN.test(text)) return parseVEvent(text);
  if (RE_MECARD.test(text)) return parseMeCard(text);
  if (RE_MAILTO.test(text)) return parseMailto(text);
  if (RE_TEL.test(text)) return parseTel(text);
  if (RE_SMS.test(text)) return parseSms(text);
  if (RE_GEO.test(text)) return parseGeo(text);
  if (RE_BTC.test(text)) return parseCrypto(text);
  if (RE_ETH.test(text)) return parseCrypto(text);
  if (RE_HTTP_URL.test(text)) return parseUrl(text);
  if (RE_BARE_EMAIL.test(text)) return parseBareEmail(text);
  return parseText(text);
}

// ────────────────────────────── Parsers ──────────────────────────────

function parseUrl(text) {
  const safety = assessUrl(text);
  return {
    type: 'url',
    label: 'Website',
    title: text,
    fields: [],
    safety,
    actions: [
      { kind: 'link', label: 'Open', href: text, primary: true },
      { kind: 'copy', label: 'Copy', value: text },
    ],
    raw: text,
  };
}

function parseWifi(text) {
  const f = parseWifiPayload(text);
  const isOpen = !f.auth || f.auth.toLowerCase() === 'nopass';
  const fields = [
    { label: 'Network', value: f.ssid || '—' },
    { label: 'Security', value: isOpen ? 'Open' : f.auth.toUpperCase() },
  ];
  if (f.password != null && f.password !== '') {
    fields.push({ label: 'Password', value: f.password, monospace: true });
  }
  if (f.hidden) fields.push({ label: 'Hidden', value: 'Yes' });

  const actions = [];
  if (f.ssid) actions.push({ kind: 'copy', label: 'Copy network name', value: f.ssid });
  if (f.password) actions.push({ kind: 'copy', label: 'Copy password', value: f.password, primary: true });

  return { type: 'wifi', label: 'Wi-Fi', title: f.ssid || 'Wi-Fi network', fields, actions, raw: text };
}

function parseVCard(text) {
  const f = parseVCardPayload(text);
  const fields = [];
  if (f.fn) fields.push({ label: 'Name', value: f.fn });
  if (f.org) fields.push({ label: 'Organization', value: f.org });
  if (f.title) fields.push({ label: 'Title', value: f.title });
  for (const tel of f.tels) fields.push({ label: 'Phone', value: tel, monospace: true });
  for (const email of f.emails) fields.push({ label: 'Email', value: email });

  const actions = [
    { kind: 'download', label: 'Save contact (.vcf)', filename: vcardFilename(f), content: text, mime: 'text/vcard', primary: true },
  ];
  for (const tel of f.tels) actions.push({ kind: 'link', label: `Call ${tel}`, href: `tel:${tel}` });

  return {
    type: 'vcard',
    label: 'Contact',
    title: f.fn || 'Contact card',
    fields,
    actions,
    raw: text,
  };
}

function parseMeCard(text) {
  const f = parseMeCardPayload(text);
  const fields = [];
  if (f.name) fields.push({ label: 'Name', value: f.name });
  if (f.tel) fields.push({ label: 'Phone', value: f.tel, monospace: true });
  if (f.email) fields.push({ label: 'Email', value: f.email });
  if (f.note) fields.push({ label: 'Note', value: f.note });

  const vcard = mecardToVCard(f);
  return {
    type: 'mecard',
    label: 'Contact',
    title: f.name || 'Contact card',
    fields,
    actions: [
      { kind: 'download', label: 'Save contact (.vcf)', filename: 'contact.vcf', content: vcard, mime: 'text/vcard', primary: true },
      { kind: 'copy', label: 'Copy', value: text },
    ],
    raw: text,
  };
}

function parseVEvent(text) {
  const f = parseVEventPayload(text);
  const fields = [];
  if (f.summary) fields.push({ label: 'Event', value: f.summary });
  if (f.location) fields.push({ label: 'Location', value: f.location });
  if (f.start) fields.push({ label: 'Start', value: f.start });
  if (f.end) fields.push({ label: 'End', value: f.end });
  return {
    type: 'vevent',
    label: 'Event',
    title: f.summary || 'Calendar event',
    fields,
    actions: [
      { kind: 'download', label: 'Add to calendar (.ics)', filename: 'event.ics', content: text, mime: 'text/calendar', primary: true },
      { kind: 'copy', label: 'Copy', value: text },
    ],
    raw: text,
  };
}

function parseMailto(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return parseText(text);
  }
  const email = url.pathname || '';
  const subject = url.searchParams.get('subject') || '';
  const body = url.searchParams.get('body') || '';
  const fields = [];
  if (subject) fields.push({ label: 'Subject', value: subject });
  if (body) fields.push({ label: 'Body', value: body });

  return {
    type: 'email',
    label: 'Email',
    title: email || 'Compose email',
    fields,
    actions: [
      { kind: 'link', label: 'Compose', href: text, primary: true },
      { kind: 'copy', label: 'Copy address', value: email },
    ],
    raw: text,
  };
}

function parseBareEmail(text) {
  return {
    type: 'email',
    label: 'Email',
    title: text,
    fields: [],
    actions: [
      { kind: 'link', label: 'Compose', href: `mailto:${text}`, primary: true },
      { kind: 'copy', label: 'Copy', value: text },
    ],
    raw: text,
  };
}

function parseTel(text) {
  const number = text.slice('tel:'.length).replace(/[^\d+*#\-().\s]/g, '');
  return {
    type: 'tel',
    label: 'Phone',
    title: number || text,
    fields: [],
    actions: [
      { kind: 'link', label: 'Call', href: text, primary: true },
      { kind: 'copy', label: 'Copy', value: number },
    ],
    raw: text,
  };
}

function parseSms(text) {
  // sms:<number>?body=...  or  smsto:<number>:<body>
  let number = '';
  let body = '';
  if (/^sms:/i.test(text)) {
    try {
      const u = new URL(text);
      number = u.pathname;
      body = u.searchParams.get('body') || '';
    } catch {
      number = text.slice('sms:'.length);
    }
  } else {
    // smsto:number:body
    const rest = text.slice('smsto:'.length);
    const idx = rest.indexOf(':');
    number = idx === -1 ? rest : rest.slice(0, idx);
    body = idx === -1 ? '' : rest.slice(idx + 1);
  }
  const fields = [];
  if (body) fields.push({ label: 'Message', value: body });
  const href = body ? `sms:${number}?body=${encodeURIComponent(body)}` : `sms:${number}`;
  return {
    type: 'sms',
    label: 'SMS',
    title: number || 'SMS',
    fields,
    actions: [
      { kind: 'link', label: 'Compose SMS', href, primary: true },
      { kind: 'copy', label: 'Copy number', value: number },
    ],
    raw: text,
  };
}

function parseGeo(text) {
  // geo:lat,lng?q=...
  const rest = text.slice('geo:'.length);
  const q = rest.split('?')[0];
  const [lat, lng] = q.split(',');
  const fields = [];
  if (lat) fields.push({ label: 'Latitude', value: lat, monospace: true });
  if (lng) fields.push({ label: 'Longitude', value: lng, monospace: true });
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  return {
    type: 'geo',
    label: 'Location',
    title: q || 'Map point',
    fields,
    actions: [
      { kind: 'link', label: 'Open in Maps', href: mapsHref, primary: true },
      { kind: 'copy', label: 'Copy coordinates', value: q },
    ],
    raw: text,
  };
}

function parseCrypto(text) {
  const fields = [{ label: 'Address', value: text, monospace: true }];
  return {
    type: 'crypto',
    label: 'Crypto address',
    title: text.length > 48 ? text.slice(0, 45) + '…' : text,
    fields,
    actions: [
      { kind: 'copy', label: 'Copy address', value: text, primary: true },
    ],
    raw: text,
  };
}

function parseText(text) {
  return {
    type: 'text',
    label: 'Text',
    title: text,
    fields: [],
    actions: [{ kind: 'copy', label: 'Copy', value: text, primary: true }],
    raw: text,
  };
}

// ────────────────────────────── Payload parsers ──────────────────────────────

/**
 * Parse WIFI:S:<ssid>;T:<auth>;P:<password>;H:<hidden>;;
 * Respects backslash-escaping for \; \: \\ \" \,
 */
function parseWifiPayload(text) {
  const body = text.slice(text.indexOf(':') + 1);
  const tokens = splitEscaped(body, ';');
  const out = { ssid: '', auth: '', password: '', hidden: false };
  for (const tok of tokens) {
    const idx = tok.indexOf(':');
    if (idx === -1) continue;
    const key = tok.slice(0, idx).toUpperCase();
    const val = unescape(tok.slice(idx + 1));
    if (key === 'S') out.ssid = val;
    else if (key === 'T') out.auth = val;
    else if (key === 'P') out.password = val;
    else if (key === 'H') out.hidden = val === 'true';
  }
  if (!out.auth) out.auth = 'nopass';
  return out;
}

function parseVCardPayload(text) {
  const out = { fn: '', org: '', title: '', tels: [], emails: [] };
  const seenTel = new Set();
  const seenEmail = new Set();
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const keyProp = line.slice(0, idx).toLowerCase();
    const value = unescape(line.slice(idx + 1));
    const base = keyProp.split(';')[0].split('.')[0]; // drop params/TYPE
    if (base === 'fn' && !out.fn) out.fn = value;
    else if (base === 'org' && !out.org) out.org = value;
    else if (base === 'title' && !out.title) out.title = value;
    else if (base === 'tel' && !seenTel.has(value)) {
      out.tels.push(value);
      seenTel.add(value);
    } else if (base === 'email' && !seenEmail.has(value)) {
      out.emails.push(value);
      seenEmail.add(value);
    }
  }
  return out;
}

function parseMeCardPayload(text) {
  const body = text.slice('MECARD:'.length).replace(/;;$/, '');
  const out = { name: '', tel: '', email: '', note: '' };
  for (const tok of splitEscaped(body, ';')) {
    const idx = tok.indexOf(':');
    if (idx === -1) continue;
    const key = tok.slice(0, idx).toUpperCase();
    const val = unescape(tok.slice(idx + 1));
    if (key === 'N') out.name = val;
    else if (key === 'TEL') out.tel = val;
    else if (key === 'EMAIL') out.email = val;
    else if (key === 'NOTE') out.note = val;
  }
  return out;
}

function parseVEventPayload(text) {
  const out = { summary: '', location: '', start: '', end: '' };
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).split(';')[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (key === 'SUMMARY' && !out.summary) out.summary = value;
    else if (key === 'LOCATION' && !out.location) out.location = value;
    else if (key === 'DTSTART' && !out.start) out.start = formatIcsDate(value);
    else if (key === 'DTEND' && !out.end) out.end = formatIcsDate(value);
  }
  return out;
}

// ────────────────────────────── Helpers ──────────────────────────────

/** Split on `sep` while respecting backslash-escaping (\\; \\: \\. \\" \\,). */
function splitEscaped(str, sep) {
  const parts = [];
  let buf = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) {
      buf += ch + str[++i];
    } else if (ch === sep) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

/** Reverse the QR-style backslash escaping. */
function unescape(s) {
  return s.replace(/\\(.)/g, (_, c) => c);
}

function vcardFilename(f) {
  const base = (f.fn || f.org || 'contact').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return `${base || 'contact'}.vcf`;
}

function mecardToVCard(f) {
  const [family, ...given] = (f.name || '').split(',').map((s) => s.trim());
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    family ? `N:${family};${given.join(' ')};;;` : `N:;;;;`,
    f.name ? `FN:${f.name}` : 'FN:',
    f.tel ? `TEL;TYPE=CELL:${f.tel}` : null,
    f.email ? `EMAIL:${f.email}` : null,
    f.note ? `NOTE:${f.note}` : null,
    'END:VCARD',
  ];
  return lines.filter(Boolean).join('\r\n');
}

function formatIcsDate(value) {
  // Handles "20240115T103000Z" and "20240115T103000" approximately.
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/**
 * Heuristic URL safety check. Flags things often used in phishing/scam QR codes.
 * Not a security boundary — just a nudge to look before jumping.
 */
function assessUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const reasons = [];
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname) || /^\[?[0-9a-f:]+]?$/i.test(u.hostname);
    if (isIp) reasons.push('uses an IP address instead of a domain');
    if (/xn--/i.test(u.hostname)) reasons.push('uses punycode (mixed-script characters)');
    if (u.username || u.password) reasons.push('contains embedded credentials');
    if (u.protocol === 'http:') reasons.push('not HTTPS');
    if (/[^\x00-\x7F]/.test(u.hostname)) reasons.push('contains non-ASCII characters');
    return { isSafe: reasons.length === 0, reasons };
  } catch {
    return { isSafe: false, reasons: ['invalid URL'] };
  }
}
