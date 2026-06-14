# QR Scanner — PWA

A fast, installable, offline-capable QR code scanner. Live camera scan + scan-from-image-file.
No build step, plain static HTML/CSS/JS, deployable to Cloudflare Pages.

## Features
- 📷 Live camera scanning (rear camera preferred)
- 🖼️ Scan a QR from an uploaded image file
- 📋 Copy result / 🔗 open URLs in one tap
- 📲 Installable PWA, works offline (service worker caches the app shell)
- 🌗 Dark, mobile-first UI

## Tech
- [qr-scanner](https://github.com/nimiq/qr-scanner) (vendored in `vendor/`) — lightweight QR engine with high detection rate.
- Service worker for offline + PWA installability.
- No framework, no bundler.

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
index.html              App shell
css/style.css           Dark, mobile-first styles
js/app.js               Camera + file-scan logic, result handling
manifest.webmanifest    PWA manifest
sw.js                   Service worker (cache-first app shell)
vendor/                 Vendored qr-scanner library + worker
icons/                  192/512 PWA icons (+ source.svg)
wrangler.toml           Cloudflare Pages config
```

## Notes
- The `qr-scanner` worker is loaded relative to `app.js` via `QrScanner.WORKER_PATH`, so the app stays self-contained and offline-capable.
- To update the scanner, replace the two files in `vendor/` and bump the cache version in `sw.js` (`qr-scanner-v1`).
