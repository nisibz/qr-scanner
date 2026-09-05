#!/usr/bin/env node
// Stamps the app version (package.json — the single source of truth) into:
//   - public/sw.js            generated from sw-template.js (__APP_VERSION__)
//   - public/manifest.webmanifest  "version" field
// Runs automatically before every build (prebuild). Never edit by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const v = pkg.version;

// sw.js: always regenerate from the template so the template stays the only
// place the service worker logic lives.
const template = readFileSync(resolve(root, 'sw-template.js'), 'utf8');
if (!template.includes('__APP_VERSION__')) {
  console.error('[version] sw-template.js is missing __APP_VERSION__');
  process.exit(1);
}
writeFileSync(resolve(root, 'public/sw.js'), template.replaceAll('__APP_VERSION__', v));

// manifest: update the version field, preserve the rest.
const manifestPath = resolve(root, 'public/manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = v;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`[version] qr-scanner-v${v}`);
