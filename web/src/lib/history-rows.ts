// Presentation helpers for history list rows: which icon to draw, a short
// human title, a subtype label, and time formatting. UI-layer logic — the
// domain types live in types.ts.

import { truncate, type HistoryRecord } from './types';

// Icon paths per scan type (24×24 stroke icons, drawn in HistorySheet).
export const TYPE_ICONS: Record<string, string> = {
  url: 'M10 14a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1.2 1.1M14 10a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1.2-1.1',
  wifi: 'M2.5 9a15 15 0 0119 0M5.5 12.5a10.5 10.5 0 0113 0M8.5 16a6 6 0 017 0M12 19.5h.01',
  vcard: 'M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20a7 7 0 0114 0',
  mecard: 'M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20a7 7 0 0114 0',
  vevent: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  email: 'M3 6h18v12H3zM3 7l9 6 9-6',
  mailto: 'M3 6h18v12H3zM3 7l9 6 9-6',
  tel: 'M5 4h4l1.5 4.5L8 10a12 12 0 006 6l1.5-2.5L20 15v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2',
  sms: 'M5 4h4l1.5 4.5L8 10a12 12 0 006 6l1.5-2.5L20 15v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2',
  geo: 'M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  crypto: 'M12 2v20M17 6.5C17 4.6 14.8 4 12 4s-5 .9-5 2.5S9 9 12 9s5 .9 5 2.5S14.8 14 12 14s-5 .9-5 2.5S9.2 20 12 20s5-.6 5-2.5',
  text: 'M4 6h16M4 12h16M4 18h10',
};

/**
 * Short display name + subtitle for a history row.
 * `titles` maps content → a human title (page <title>) captured at scan time;
 * without it URLs fall back to the domain, which is stable and truthful.
 */
export function rowVisuals(
  type: string,
  content: string,
  titles?: Map<string, string>,
): { icon: string; title: string; sub: string } {
  try {
    switch (type) {
      case 'url': {
        const u = new URL(content);
        const saved = titles?.get(content);
        if (saved) {
          // e.g. "Example Domain" · example.com — captured from the page
          // <title> at scan time; the most reliable human-readable label.
          return { icon: TYPE_ICONS.url, title: truncate(saved, 48), sub: u.host.replace(/^www\./, '') };
        }
        // No saved title: show the domain (stable, truthful) rather than a
        // prettified path segment, which reads as noise for URLs you don't
        // recognise. The full path is still in the raw payload — tap to view.
        return { icon: TYPE_ICONS.url, title: u.host.replace(/^www\./, ''), sub: 'Website — tap for full URL' };
      }
      case 'wifi': {
        const m = content.match(/S:([^;]+)/);
        return { icon: TYPE_ICONS.wifi, title: (m && m[1]) || 'Wi-Fi network', sub: 'Wi-Fi' };
      }
      case 'vcard':
      case 'mecard': {
        const fn = content.match(/FN[^:]*:([^\n]+)/) || content.match(/N:([^;\n]+)/);
        return { icon: TYPE_ICONS.vcard, title: ((fn && fn[1]) || 'Contact').trim(), sub: 'Contact' };
      }
      case 'vevent': {
        const s = content.match(/SUMMARY:([^\n]+)/);
        return { icon: TYPE_ICONS.vevent, title: ((s && s[1]) || 'Event').trim(), sub: 'Event' };
      }
      case 'email':
      case 'mailto':
        return { icon: TYPE_ICONS.email, title: content.replace(/^mailto:/, ''), sub: 'Email' };
      case 'tel':
        return { icon: TYPE_ICONS.tel, title: content.replace(/^tel:/, ''), sub: 'Phone' };
      case 'sms': {
        const num = content.match(/[:]?([+\d][\d-]{4,})/);
        return { icon: TYPE_ICONS.tel, title: (num && num[1]) || 'SMS', sub: 'SMS' };
      }
      case 'geo': {
        const m = content.match(/-?[\d.]+,-?[\d.]+/);
        return { icon: TYPE_ICONS.geo, title: (m && m[0]) || 'Location', sub: 'Location' };
      }
      case 'crypto':
        return { icon: TYPE_ICONS.crypto, title: content.slice(0, 10) + '…' + content.slice(-6), sub: 'Crypto address' };
      default:
        return { icon: TYPE_ICONS.text, title: truncate(content, 60), sub: 'Text' };
    }
  } catch {
    return { icon: TYPE_ICONS.text, title: truncate(content, 60), sub: 'Text' };
  }
}

/** Today / Yesterday / locale date — grouped against local midnight. */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function clockTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return '';
  }
}

export type { HistoryRecord };
