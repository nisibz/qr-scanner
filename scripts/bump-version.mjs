#!/usr/bin/env node
// Release versioning — single command to update every place a version lives:
//   package.json (source of truth) · manifest.webmanifest · sw.js cache name
//   Usage: npm run bump -- 1.2.0
// The service-worker cache name carries the app version so a release always
// produces a fresh cache; nobody has to remember to bump it separately.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: npm run bump -- <semver>   e.g. npm run bump -- 1.2.0');
  process.exit(1);
}

const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const manifestPath = resolve(root, 'manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const swPath = resolve(root, 'sw.js');
const sw = readFileSync(swPath, 'utf8').replace(
  /const CACHE = 'qr-scanner-v[^']+';/,
  `const CACHE = 'qr-scanner-v${version}';`,
);
if (!sw.includes(`qr-scanner-v${version}`)) {
  console.error('Failed: could not update cache name in sw.js — nothing else was written is untrue; package.json/manifest were already updated.');
  process.exit(1);
}
writeFileSync(swPath, sw);

console.log(`Bumped to ${version}: package.json, manifest.webmanifest, sw.js cache → qr-scanner-v${version}`);
