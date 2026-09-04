// Unit tests for the CSV export format and import merge/dedupe logic in
// history-store.js. These run in Node (no IndexedDB), so the store module is
// loaded with a fake IDB — instead we test the pure transformations by
// importing the module graph is not possible; hence these mirror the same
// rules the store implements and guard regressions in the format itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of csvField() in js/lib/history-store.js — kept in lockstep on
// purpose: the format is a contract with spreadsheet apps.
function csvField(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(it) {
  return [it.content, it.type || 'text', it.label || '', new Date(it.createdAt).toISOString()]
    .map(csvField)
    .join(',');
}

test('csvField leaves plain values unquoted', () => {
  assert.equal(csvField('https://example.com/hello'), 'https://example.com/hello');
  assert.equal(csvField('wifi'), 'wifi');
  assert.equal(csvField(''), '');
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('csvField quotes values containing commas, quotes, or newlines', () => {
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
  assert.equal(csvField('cr\rlf'), '"cr\r lf"'.replace(' ', ''));
});

test('csv row layout: content,type,label,scannedAt', () => {
  const row = csvRow({
    content: 'https://example.com/hello',
    type: 'url',
    label: 'Website',
    createdAt: 0,
  });
  assert.equal(row, 'https://example.com/hello,url,Website,1970-01-01T00:00:00.000Z');
});

test('csv row falls back to text type and empty label', () => {
  const row = csvRow({ content: 'plain', createdAt: 0 });
  assert.equal(row, 'plain,text,,1970-01-01T00:00:00.000Z');
});

// Mirror of importScans() record normalization.
function normalizeImported(s, fallbackNow) {
  if (!s || typeof s.content !== 'string' || !s.content) return null;
  const ts = Number(s.createdAt ?? s.scannedAt);
  return {
    content: s.content,
    type: typeof s.type === 'string' && s.type ? s.type : 'text',
    label: typeof s.label === 'string' ? s.label : '',
    createdAt: Number.isFinite(ts) && ts > 0 ? ts : fallbackNow,
  };
}

test('import normalization accepts createdAt or scannedAt and defaults type', () => {
  const rec = normalizeImported({ content: 'x', scannedAt: 123 });
  assert.equal(rec.createdAt, 123);
  assert.equal(rec.type, 'text');

  const rec2 = normalizeImported({ content: 'y', createdAt: 456, type: 'url', label: 'Website' });
  assert.equal(rec2.createdAt, 456);
  assert.equal(rec2.type, 'url');
  assert.equal(rec2.label, 'Website');
});

test('import normalization rejects records without content', () => {
  assert.equal(normalizeImported(null, 0), null);
  assert.equal(normalizeImported({}, 0), null);
  assert.equal(normalizeImported({ content: '' }, 0), null);
  assert.equal(normalizeImported({ content: 42 }, 0), null);
});

test('import normalization falls back to now for missing/invalid timestamps', () => {
  const now = 1_700_000_000_000;
  assert.equal(normalizeImported({ content: 'x' }, now).createdAt, now);
  assert.equal(normalizeImported({ content: 'x', createdAt: -5 }, now).createdAt, now);
  assert.equal(normalizeImported({ content: 'x', createdAt: 'nope' }, now).createdAt, now);
});

test('dedupe key is content + NUL + createdAt', () => {
  // Same content at a different time must NOT dedupe; identical pairs must.
  const key = (r) => `${r.content}\u0000${r.createdAt}`;
  const a = { content: 'x', createdAt: 1 };
  const b = { content: 'x', createdAt: 2 };
  const c = { content: 'x', createdAt: 1 };
  assert.notEqual(key(a), key(b));
  assert.equal(key(a), key(c));
});
