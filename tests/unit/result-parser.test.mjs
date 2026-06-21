import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResult } from '../../js/lib/result-parser.js';

test('empty input', () => {
  assert.deepEqual(parseResult(''), { type: 'empty', label: '', title: '', fields: [], actions: [], raw: '' });
  assert.equal(parseResult(null).type, 'empty');
});

test('detects https URL as safe', () => {
  const r = parseResult('https://example.com/hello');
  assert.equal(r.type, 'url');
  assert.equal(r.label, 'Website');
  assert.equal(r.safety.isSafe, true);
  assert.deepEqual(r.safety.reasons, []);
  const kinds = r.actions.map((a) => a.kind);
  assert.ok(kinds.includes('link'));
  assert.ok(kinds.includes('copy'));
  const open = r.actions.find((a) => a.kind === 'link');
  assert.equal(open.href, 'https://example.com/hello');
});

test('flags IP-host URL as suspicious', () => {
  const r = parseResult('http://192.168.1.1/login');
  assert.equal(r.type, 'url');
  assert.equal(r.safety.isSafe, false);
  assert.ok(r.safety.reasons.some((x) => /IP address/i.test(x)));
});

test('flags punycode host as suspicious', () => {
  const r = parseResult('https://xn--80ak6aa92e.com/');
  assert.equal(r.safety.isSafe, false);
  assert.ok(r.safety.reasons.some((x) => /punycode/i.test(x)));
});

test('flags URL with embedded credentials', () => {
  const r = parseResult('https://user:pass@example.com/');
  assert.equal(r.safety.isSafe, false);
  assert.ok(r.safety.reasons.some((x) => /credentials/i.test(x)));
});

test('flags non-HTTPS URL', () => {
  const r = parseResult('http://example.com/');
  assert.equal(r.safety.isSafe, false);
  assert.ok(r.safety.reasons.some((x) => /not HTTPS/i.test(x)));
});

test('parses WPA Wi-Fi payload', () => {
  const r = parseResult('WIFI:S:MyNetwork;T:WPA;P:secretpass;H:false;;');
  assert.equal(r.type, 'wifi');
  assert.equal(r.title, 'MyNetwork');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Network, 'MyNetwork');
  assert.equal(map.Security, 'WPA');
  assert.equal(map.Password, 'secretpass');
  assert.equal(map.Hidden, undefined); // H:false → not included
  const copyPw = r.actions.find((a) => a.label === 'Copy password');
  assert.equal(copyPw.value, 'secretpass');
});

test('parses Wi-Fi with empty password (open network)', () => {
  const r = parseResult('WIFI:S:Cafe;T:nopass;;');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Network, 'Cafe');
  assert.equal(map.Security, 'Open');
  assert.equal(map.Password, undefined);
});

test('handles escaped semicolons in Wi-Fi SSID', () => {
  const r = parseResult('WIFI:S:my\\;ssid;T:WPA;P:p\\;w;;');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Network, 'my;ssid');
  assert.equal(map.Password, 'p;w');
});

test('parses vCard and exposes download + call actions', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Jane Doe',
    'ORG:Acme Inc',
    'TITLE:Engineer',
    'TEL:+1-555-123-4567',
    'EMAIL:jane@example.com',
    'END:VCARD',
  ].join('\r\n');
  const r = parseResult(text);
  assert.equal(r.type, 'vcard');
  assert.equal(r.title, 'Jane Doe');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Name, 'Jane Doe');
  assert.equal(map.Organization, 'Acme Inc');
  assert.equal(map.Phone, '+1-555-123-4567');
  const dl = r.actions.find((a) => a.kind === 'download');
  assert.equal(dl.mime, 'text/vcard');
  assert.match(dl.filename, /\.vcf$/);
  assert.equal(dl.content, text);
  const call = r.actions.find((a) => a.kind === 'link');
  assert.equal(call.href, 'tel:+1-555-123-4567');
});

test('parses vCard with TYPE params on TEL', () => {
  const text = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Bob', 'TEL;TYPE=CELL:+555', 'END:VCARD'].join('\r\n');
  const r = parseResult(text);
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Phone, '+555');
});

test('parses mailto: with subject and body', () => {
  const r = parseResult('mailto:foo@bar.com?subject=Hi&body=Hello');
  assert.equal(r.type, 'email');
  assert.equal(r.title, 'foo@bar.com');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Subject, 'Hi');
  assert.equal(map.Body, 'Hello');
  const compose = r.actions.find((a) => a.kind === 'link');
  assert.equal(compose.href, 'mailto:foo@bar.com?subject=Hi&body=Hello');
});

test('detects bare email (no mailto: prefix)', () => {
  const r = parseResult('foo@bar.com');
  assert.equal(r.type, 'email');
  const compose = r.actions.find((a) => a.kind === 'link');
  assert.equal(compose.href, 'mailto:foo@bar.com');
});

test('parses tel: payload', () => {
  const r = parseResult('tel:+1-555-123-4567');
  assert.equal(r.type, 'tel');
  const call = r.actions.find((a) => a.kind === 'link');
  assert.equal(call.href, 'tel:+1-555-123-4567');
});

test('parses sms: with body', () => {
  const r = parseResult('sms:+1555?body=Hello%20there');
  assert.equal(r.type, 'sms');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Message, 'Hello there');
  const compose = r.actions.find((a) => a.kind === 'link');
  assert.ok(compose.href.startsWith('sms:+1555'));
});

test('parses smsto: payload', () => {
  const r = parseResult('smsto:+1555:Hi there');
  assert.equal(r.type, 'sms');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Message, 'Hi there');
});

test('parses geo: coordinates', () => {
  const r = parseResult('geo:37.7749,-122.4194');
  assert.equal(r.type, 'geo');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Latitude, '37.7749');
  assert.equal(map.Longitude, '-122.4194');
  const open = r.actions.find((a) => a.kind === 'link');
  assert.match(open.href, /google\.com\/maps/);
});

test('parses MECARD and converts to vCard for download', () => {
  const r = parseResult('MECARD:N:Doe,John;TEL:+1555;EMAIL:john@x.com;;');
  assert.equal(r.type, 'mecard');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Name, 'Doe,John');
  const dl = r.actions.find((a) => a.kind === 'download');
  assert.match(dl.content, /BEGIN:VCARD/);
  assert.match(dl.content, /Doe/);
});

test('parses VEVENT', () => {
  const text = [
    'BEGIN:VEVENT',
    'SUMMARY:Team meeting',
    'LOCATION:Room 5',
    'DTSTART:20240115T100000Z',
    'DTEND:20240115T110000Z',
    'END:VEVENT',
  ].join('\r\n');
  const r = parseResult(text);
  assert.equal(r.type, 'vevent');
  assert.equal(r.title, 'Team meeting');
  const map = Object.fromEntries(r.fields.map((f) => [f.label, f.value]));
  assert.equal(map.Location, 'Room 5');
  assert.equal(map.Start, '2024-01-15 10:00');
  const dl = r.actions.find((a) => a.kind === 'download');
  assert.equal(dl.mime, 'text/calendar');
});

test('detects bitcoin address', () => {
  const r = parseResult('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  assert.equal(r.type, 'crypto');
  assert.equal(r.actions[0].kind, 'copy');
});

test('plain text falls back to copy action', () => {
  const r = parseResult('Just some plain text');
  assert.equal(r.type, 'text');
  assert.equal(r.title, 'Just some plain text');
  assert.equal(r.actions[0].kind, 'copy');
  assert.equal(r.actions[0].value, 'Just some plain text');
});
