#!/usr/bin/env node
// Syncs the version from package.json into:
//  - public/sw.js cache name (__APP_VERSION__ placeholder)
//  - public/manifest.webmanifest "version" field
// Run automatically before every build (prebuild) — never edit by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const v = pkg.version;

const swPath = resolve(root, 'public/sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const CACHE = '[^']+';/, `const CACHE = 'qr-scanner-v${v}';`));

const manifestPath = resolve(root, 'public/manifest.webmanifest');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = v;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`[version] qr-scanner-v${v}`);
