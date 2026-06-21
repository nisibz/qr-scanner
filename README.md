# QR Scanner — PWA

A fast, installable, offline-capable QR code scanner. Live camera scan + scan-from-image-file.
No build step, plain static HTML/CSS/JS, deployable to Cloudflare Pages.

## Features
- 📷 Live camera scanning (rear camera preferred)
- 🖼️ Scan a QR from an uploaded image file
- 🧠 Smart result handling — detects URL / Wi-Fi / vCard / MECARD / email / phone / SMS / location / calendar event / crypto address and offers type-specific actions (open, call, compose, download `.vcf`/`.ics`, copy password…). Suspicious URLs trigger a safety warning.
- 📚 Scan history (IndexedDB, on-device) with search, type filter, export, and a per-device privacy toggle
- 🔦 Camera controls (when the device supports them): torch/flashlight, zoom slider, front/rear camera switch
- 📥 Batch mode — collect many unique scans into a working list (inventory, check-in) and export it
- 📋 Copy result / 🔗 open URLs in one tap
- 📲 Installable PWA, works offline (service worker caches the app shell)
- 🌗 Dark, mobile-first UI

## Tech
- [qr-scanner](https://github.com/nimiq/qr-scanner) (vendored in `vendor/`) — lightweight QR engine with high detection rate.
- Native ES modules — no framework, no bundler.
- IndexedDB for local history; service worker for offline + PWA installability.
- Playwright (E2E) + `node:test` (parser unit tests) + Lighthouse CI.

## Run locally

Camera APIs require a **secure context**. `localhost` counts as secure, so a plain local server works:

```bash
npx serve .
# or:  python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:3000`) and grant camera permission.

> Opening `index.html` directly via `file://` will **not** work — camera access is blocked on `file://`.

## Deploy to Cloudflare Pages

**One-time:** log in with `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN`).

Then, from the project root:

```bash
npx wrangler pages deploy .
```

On the first run, Wrangler will prompt for a project name and create it. Subsequent deploys push straight to production over HTTPS.

**Git integration (CI deploys):** connect this repo in the Cloudflare dashboard → Workers & Pages → *Create* → *Pages* → *Connect to Git*. This is a **pure static site with no build step**, so set:
- **Framework preset:** *None*
- **Build command:** *(leave empty)*
- **Build output directory:** `/` (the repo root — all static files live here)
- **Root directory:** `/`

Do **not** put `npx wrangler deploy` as the build command — Cloudflare Pages uploads the output directory automatically; a manual deploy command conflicts with that and fails. Pushing to your production branch then redeploys on every commit.

## Project layout
```
index.html                 App shell
css/style.css              Dark, mobile-first styles
js/app.js                  Orchestrator: UI state, events, wiring
js/lib/scanner.js          Wrapper around the vendored QrScanner + device controls
js/lib/result-parser.js    QR content type detection + action model
js/lib/history-store.js    IndexedDB-backed local history
manifest.webmanifest       PWA manifest
sw.js                      Service worker (cache-first app shell)
vendor/                    Vendored qr-scanner library + worker
icons/                     192/512 PWA icons (+ source.svg)
wrangler.toml              Cloudflare Pages config
playwright.config.js       E2E test config
tests/e2e/                 Playwright browser tests
tests/unit/                node:test parser unit tests
tests/fixtures/            QR image fixtures + generator
lighthouserc.json          Lighthouse CI config
```

## Develop / test

The app itself has **no build step** — it's plain static files served as-is.
Node dev tooling (Playwright, Lighthouse CI) is for testing only.

```bash
npm install                 # one-time: fetch dev tooling
npm run serve               # serve app at http://localhost:5173
npm run test:unit           # parser unit tests (node:test)
npm test                    # Playwright E2E tests
npm run test:fixtures       # regenerate QR image fixtures
npm run lighthouse          # Lighthouse CI against local server
```

CI runs both unit + E2E and Lighthouse on every push/PR (`.github/workflows/ci.yml`).

## Notes
- The `qr-scanner` worker is loaded relative to `scanner.js` via `QrScanner.WORKER_PATH`, so the app stays self-contained and offline-capable.
- History lives in IndexedDB on the device; nothing leaves the browser. A toggle in the History view controls whether new scans are saved.
- Camera controls (torch / zoom / switch) only appear when the active stream advertises the capability — they degrade gracefully on unsupported hardware.
- To update the scanner, replace the two files in `vendor/`, bump the cache version in `sw.js` (`qr-scanner-v5`), and regenerate test fixtures.
