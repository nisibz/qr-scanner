import { createScanner, mapCameraError } from './lib/scanner.js';
import { parseResult } from './lib/result-parser.js';
import * as history from './lib/history-store.js';

const $ = (id) => document.getElementById(id);

const video = $('video');
const overlay = $('overlay');
const status = $('status');
const retryBtn = $('retryBtn');
const fileInput = $('fileInput');
const result = $('result');
const resultLabel = $('resultLabel');
const resultText = $('resultText');
const resultFields = $('resultFields');
const resultWarning = $('resultWarning');
const resultActions = $('resultActions');
const clearBtn = $('clearBtn');

// Device-control elements
const torchBtn = $('torchBtn');
const switchCamBtn = $('switchCamBtn');
const zoomControl = $('zoomControl');
const zoomSlider = $('zoomSlider');
const zoomValue = $('zoomValue');

// Batch elements
const batchControls = $('batchControls');
const batchToggle = $('batchToggle');
const batchViewBtn = $('batchViewBtn');
const batchCount = $('batchCount');
const batchView = $('batchView');
const batchViewCount = $('batchViewCount');
const batchClose = $('batchClose');
const batchList = $('batchList');
const batchEmpty = $('batchEmpty');
const batchExport = $('batchExport');
const batchClear = $('batchClear');

// History elements
const historyBtn = $('historyBtn');
const historyCount = $('historyCount');
const historyView = $('historyView');
const historyClose = $('historyClose');
const historySearch = $('historySearch');
const historyFilter = $('historyFilter');
const historyEnabled = $('historyEnabled');
const historyList = $('historyList');
const historyEmpty = $('historyEmpty');
const historyExport = $('historyExport');
const historyExportCsv = $('historyExportCsv');
const historyImport = $('historyImport');
const importInput = $('importInput');
const historyClear = $('historyClear');
const appVersion = $('appVersion');

// Install prompt elements
const installPrompt = $('installPrompt');
const installBtn = $('installBtn');
const installDismiss = $('installDismiss');
const installHint = $('installHint');
const installIos = $('installIos');

// In-memory batch collection (not persisted).
const batchItems = [];
let batchSeen = new Set();
let cameraList = [];
let cameraIndex = 0;

// Dedupe guards for the camera scan loop. The qr-scanner library fires
// onResult on every decoded frame (up to 10/s), so without these the same
// code held in view floods history and fights the user's scroll.
let lastCameraRaw = null;   // last content decoded from the camera
let lastRenderedRaw = null; // content currently shown in the result panel

function setStatus(msg) {
  status.textContent = msg || '';
}

function clearResult() {
  result.hidden = true;
  resultLabel.textContent = 'Decoded';
  resultText.textContent = '';
  resultFields.innerHTML = '';
  resultWarning.hidden = true;
  resultWarning.textContent = '';
  resultActions.innerHTML = '';
  // Reset so re-scanning the same code after dismissing re-renders, scrolls,
  // and (for the camera) re-evaluates persistence from a clean slate.
  lastCameraRaw = null;
  lastRenderedRaw = null;
}

function renderResult(parsed) {
  const isNew = parsed.raw !== lastRenderedRaw;
  lastRenderedRaw = parsed.raw;
  resultLabel.textContent = parsed.label || 'Decoded';
  resultText.textContent = parsed.title || '';
  renderFields(parsed.fields || []);
  renderWarning(parsed.safety);
  renderActions(parsed.actions || []);
  result.hidden = false;
  // The result is a bottom sheet overlaying the camera on mobile (inline on
  // desktop) — it appears in place, no scrolling needed. Only buzz on a
  // genuinely new code; repeat frames would otherwise vibrate 10 times/sec.
  if (isNew && navigator.vibrate) navigator.vibrate(40);
}

function renderFields(fields) {
  resultFields.innerHTML = '';
  for (const f of fields) {
    const dt = document.createElement('dt');
    dt.className = 'result__field-label';
    dt.textContent = f.label;
    const dd = document.createElement('dd');
    dd.className = 'result__field-value';
    if (f.monospace) dd.classList.add('result__field-value--mono');
    dd.textContent = f.value;
    resultFields.appendChild(dt);
    resultFields.appendChild(dd);
  }
}

function renderWarning(safety) {
  if (!safety || safety.isSafe) {
    resultWarning.hidden = true;
    resultWarning.textContent = '';
    return;
  }
  resultWarning.hidden = false;
  const strong = document.createElement('strong');
  strong.textContent = 'Heads up — ';
  const span = document.createElement('span');
  span.textContent = safety.reasons.join('; ') + '.';
  resultWarning.replaceChildren(strong, span);
}

function renderActions(actions) {
  resultActions.innerHTML = '';
  for (const a of actions) {
    resultActions.appendChild(makeActionElement(a));
  }
}

function makeActionElement(a) {
  if (a.kind === 'link') {
    const link = document.createElement('a');
    link.className = 'btn ' + (a.primary ? 'btn--primary' : 'btn--ghost');
    link.href = a.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = a.label;
    return link;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn ' + (a.primary ? 'btn--primary' : 'btn--ghost');
  btn.textContent = a.label;
  if (a.kind === 'copy') {
    // Feedback goes on the button itself ("Copied ✓", brief green flash) —
    // the status bar sits behind the bottom sheet and is easy to miss.
    btn.addEventListener('click', async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(a.value);
        ok = true;
      } catch {
        ok = fallbackCopy(a.value);
      }
      const original = a.label;
      setStatus(ok ? 'Copied to clipboard' : 'Copy failed — select and copy manually.');
      btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      btn.classList.toggle('btn--ok', ok);
      if (navigator.vibrate) navigator.vibrate(ok ? 20 : [10, 40, 10]);
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('btn--ok');
      }, 1200);
    });
  } else if (a.kind === 'download') {
    btn.addEventListener('click', () => downloadBlob(a.filename, a.content, a.mime));
  }
  return btn;
}

// Clipboard API needs a secure context and user permission; execCommand is the
// legacy escape hatch (hidden textarea + select + copy) for the rest.
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function downloadBlob(filename, content, mime) {
  try {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus('Downloaded ' + filename);
  } catch (err) {
    setStatus('Download failed: ' + (err && err.message ? err.message : 'unknown error'));
  }
}

function handleDecoded(raw, { source } = {}) {
  if (!raw) return;
  const parsed = parseResult(raw);

  if (batchToggle.checked) {
    addToBatch(parsed);
    return;
  }

  renderResult(parsed);
  setStatus('Scanned');
  // Re-displaying a saved history item should never re-persist it.
  if (source === 'history') return;
  // Camera scanning: one history entry per code. While the same code stays
  // in view, every decoded frame is identical to the last, so skip writing.
  if (source === 'camera') {
    if (raw === lastCameraRaw) return;
    lastCameraRaw = raw;
  }
  // File scans always go through; IndexedDB dedupe still applies.
  // Persist to history (no-op if disabled or deduped)
  history
    .addScan({ content: parsed.raw, type: parsed.type, label: parsed.label })
    .then((rec) => {
      if (!rec) return;
      refreshHistoryCount();
      if (!historyView.hidden) renderHistory();
    })
    .catch(() => {
      /* private mode / unavailable — silently ignore */
    });
}

// Scanner result callback — re-render result on every successful decode.
function onDecoded(raw) {
  handleDecoded(raw, { source: 'camera' });
}

// ────────────────────────────── Batch mode ──────────────────────────────

function addToBatch(parsed) {
  const key = parsed.raw;
  if (batchSeen.has(key)) {
    setStatus(`Already in batch (${batchItems.length})`);
    if (navigator.vibrate) navigator.vibrate(15);
    return;
  }
  batchSeen.add(key);
  batchItems.push({
    content: parsed.raw,
    type: parsed.type,
    label: parsed.label,
    title: parsed.title,
    actions: parsed.actions || [],
    scannedAt: Date.now(),
  });
  updateBatchBadge();
  setStatus(`Added to batch (${batchItems.length})`);
  if (navigator.vibrate) navigator.vibrate(40);
}

function updateBatchBadge() {
  const n = batchItems.length;
  batchCount.textContent = n > 99 ? '99+' : String(n);
  if (!batchViewBtn.hidden) {
    batchViewCount.textContent = batchCount.textContent;
  }
}

function renderBatch() {
  batchList.innerHTML = '';
  batchEmpty.hidden = batchItems.length !== 0;
  batchViewCount.textContent = batchItems.length > 99 ? '99+' : String(batchItems.length);

  // Newest first
  for (const it of [...batchItems].reverse()) {
    const li = document.createElement('li');
    li.className = 'hitem';

    const meta = document.createElement('div');
    meta.className = 'hitem__meta';
    const badge = document.createElement('span');
    badge.className = 'hitem__type';
    badge.textContent = it.label || it.type || 'Text';
    const time = document.createElement('time');
    time.className = 'hitem__time';
    time.dateTime = new Date(it.scannedAt).toISOString();
    time.textContent = formatRelativeTime(it.scannedAt);
    meta.appendChild(badge);
    meta.appendChild(time);
    li.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'hitem__body hitem__body--static';
    body.textContent = truncate(it.content, 160);
    li.appendChild(body);

    if (it.actions && it.actions.length) {
      const acts = document.createElement('div');
      acts.className = 'hitem__actions';
      for (const a of it.actions) acts.appendChild(makeActionElement(a));
      li.appendChild(acts);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hitem__del';
    del.setAttribute('aria-label', 'Remove from batch');
    del.textContent = '✕';
    del.addEventListener('click', () => {
      const idx = batchItems.findIndex((x) => x.content === it.content);
      if (idx !== -1) {
        batchItems.splice(idx, 1);
        batchSeen = new Set(batchItems.map((x) => x.content));
        updateBatchBadge();
        renderBatch();
      }
    });
    li.appendChild(del);

    batchList.appendChild(li);
  }
}

function openBatchView() {
  batchView.hidden = false;
  renderBatch();
}

// ────────────────────────────── History UI ──────────────────────────────

// Icon paths per scan type (24×24 stroke icons, drawn in renderHistory).
const TYPE_ICONS = {
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
 * Short display name + subtitle for a history row. The parser's `title` is
 * tuned for the result card (often the full payload, e.g. a URL); the list
 * needs a scannable one-liner: domain for URLs, SSID for Wi-Fi, etc.
 */
function rowVisuals(type, content) {
  const icon = TYPE_ICONS[type] || TYPE_ICONS.text;
  try {
    switch (type) {
      case 'url': {
        const u = new URL(content);
        const path = u.pathname.replace(/\/$/, '');
        const title = u.host.replace(/^www\./, '') + (path && path.length <= 24 ? path : '');
        return { icon, title: title || u.host, sub: 'Website' };
      }
      case 'wifi': {
        const m = content.match(/S:([^;]+)/);
        return { icon, title: (m && m[1]) || 'Wi-Fi network', sub: 'Wi-Fi' };
      }
      case 'vcard':
      case 'mecard': {
        const fn = content.match(/FN[^:]*:([^\n]+)/) || content.match(/N:([^;\n]+)/);
        return { icon, title: ((fn && fn[1]) || 'Contact').trim(), sub: 'Contact' };
      }
      case 'vevent': {
        const s = content.match(/SUMMARY:([^\n]+)/);
        return { icon, title: ((s && s[1]) || 'Event').trim(), sub: 'Event' };
      }
      case 'email':
      case 'mailto':
        return { icon, title: content.replace(/^mailto:/, ''), sub: 'Email' };
      case 'tel':
        return { icon, title: content.replace(/^tel:/, ''), sub: 'Phone' };
      case 'sms': {
        const num = content.match(/[:]?([+\d][\d-]{4,})/);
        return { icon, title: (num && num[1]) || 'SMS', sub: 'SMS' };
      }
      case 'geo': {
        const m = content.match(/-?[\d.]+,-?[\d.]+/);
        return { icon, title: (m && m[0]) || 'Location', sub: 'Location' };
      }
      case 'crypto':
        return { icon, title: content.slice(0, 10) + '…' + content.slice(-6), sub: 'Crypto address' };
      default:
        return { icon, title: truncate(content, 60), sub: 'Text' };
    }
  } catch {
    return { icon: TYPE_ICONS.text, title: truncate(content, 60), sub: 'Text' };
  }
}

// Day section header for a timestamp: Today / Yesterday / locale date.
// Computed against LOCAL midnight so "Today" matches the user's day.
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function clockTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatRelativeTime(ts) {
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

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function refreshHistoryCount() {
  try {
    const n = await history.countScans();
    if (n > 0) {
      historyCount.hidden = false;
      historyCount.textContent = n > 99 ? '99+' : String(n);
    } else {
      historyCount.hidden = true;
    }
  } catch {
    historyCount.hidden = true;
  }
}

async function renderHistory() {
  const search = historySearch.value || '';
  const type = historyFilter.value || 'all';
  let items = [];
  try {
    items = await history.queryScans({ search, type });
  } catch {
    items = [];
  }

  historyList.innerHTML = '';
  historyEmpty.hidden = items.length !== 0;

  let currentDay = null;
  for (const it of items) {
    // Day section headers — scan history is naturally time-oriented, so
    // grouping by local day makes old entries findable at a glance.
    const day = dayLabel(it.createdAt);
    if (day !== currentDay) {
      currentDay = day;
      const h = document.createElement('li');
      h.className = 'pday';
      h.textContent = day;
      h.setAttribute('aria-hidden', 'true');
      historyList.appendChild(h);
    }

    const { icon, title, sub } = rowVisuals(it.type, it.content);

    const li = document.createElement('li');
    li.className = 'prow';
    li.dataset.id = it.id;

    const tile = document.createElement('span');
    tile.className = 'prow__icon';
    tile.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', icon);
    svg.appendChild(path);
    tile.appendChild(svg);
    li.appendChild(tile);

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'prow__body';
    const titleEl = document.createElement('span');
    titleEl.className = 'prow__title';
    titleEl.textContent = title;
    const subEl = document.createElement('span');
    subEl.className = 'prow__sub';
    subEl.textContent = sub;
    body.append(titleEl, subEl);
    body.addEventListener('click', () => viewHistoryItem(it));
    li.appendChild(body);

    const time = document.createElement('time');
    time.className = 'prow__time';
    time.dateTime = new Date(it.createdAt).toISOString();
    time.textContent = clockTime(it.createdAt);
    li.appendChild(time);

    // Full-row swipe-to-delete on touch: translate the row past a threshold.
    let startX = null;
    li.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      li.style.transition = 'none';
    }, { passive: true });
    li.addEventListener('touchmove', (e) => {
      if (startX === null) return;
      const dx = Math.min(0, e.touches[0].clientX - startX);
      li.style.transform = `translateX(${Math.max(dx, -96)}px)`;
    }, { passive: true });
    li.addEventListener('touchend', async (e) => {
      if (startX === null) return;
      li.style.transition = '';
      const dx = e.changedTouches[0].clientX - startX;
      li.style.transform = '';
      startX = null;
      if (dx < -72) {
        try {
          await history.removeScan(it.id);
          await Promise.all([renderHistory(), refreshHistoryCount()]);
          setStatus('Deleted');
        } catch {
          /* ignore */
        }
      }
    });

    historyList.appendChild(li);
  }
}

function viewHistoryItem(item) {
  historyView.hidden = true;
  handleDecoded(item.content, { source: 'history' });
}

function openHistory() {
  historyView.hidden = false;
  historyEnabled.checked = history.isHistoryEnabled();
  renderHistory();
}

function closeHistory() {
  historyView.hidden = true;
}

// ────────────────────────────── Device controls ──────────────────────────────

function hideDeviceControls() {
  torchBtn.hidden = true;
  switchCamBtn.hidden = true;
  zoomControl.hidden = true;
}

function refreshDeviceControls() {
  // Torch
  const torch = scanner.getTorchState();
  if (torch.supported) {
    torchBtn.hidden = false;
    torchBtn.textContent = torch.on ? 'Flash off' : 'Flash on';
    torchBtn.setAttribute('aria-pressed', String(torch.on));
  } else {
    torchBtn.hidden = true;
  }

  // Zoom
  const zoom = scanner.getZoomState();
  if (zoom.supported) {
    zoomControl.hidden = false;
    zoomSlider.min = zoom.min;
    zoomSlider.max = zoom.max;
    zoomSlider.step = zoom.step;
    zoomSlider.value = zoom.current;
    zoomValue.textContent = formatZoom(zoom.current);
  } else {
    zoomControl.hidden = true;
  }

  // Camera switch (only if more than one camera)
  if (cameraList.length > 1) {
    switchCamBtn.hidden = false;
  } else {
    switchCamBtn.hidden = true;
  }
}

function formatZoom(v) {
  if (v == null) return '';
  // MediaDevices zoom is a multiplier; show like "2.0×".
  const n = Number(v);
  return (Math.round(n * 10) / 10).toFixed(1) + '×';
}

// ────────────────────────────── Camera lifecycle ──────────────────────────────

// Human-friendly status text per ScannerError name.
function friendlyStatus(err) {
  switch (err.name) {
    case 'InsecureContext':
      return 'Camera needs a secure context (localhost or HTTPS). Open the deployed URL or scan an image instead.';
    case 'NoCamera':
      return 'No camera found on this device. Scan an image instead.';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission denied. Allow access or scan an image instead.';
    case 'NotFoundError':
      return 'No camera found. Try scanning an image instead.';
    case 'NotReadableError':
      return 'Camera is in use by another app. Close it and retry.';
    default:
      return 'Could not start camera: ' + (err.message || 'unknown error');
  }
}

const scanner = createScanner({ video, onResult: onDecoded });

async function startCamera() {
  clearResult();
  retryBtn.hidden = true;
  batchControls.hidden = true;
  hideDeviceControls();
  setStatus('Starting camera…');

  try {
    await scanner.start();
    overlay.hidden = false;
    setStatus('Point at a QR code');
    // Enumerate cameras (needs the permission granted above to label them).
    cameraList = await scanner.listCameras();
    cameraIndex = 0;
    refreshDeviceControls();
    batchControls.hidden = false;
  } catch (err) {
    setStatus(friendlyStatus(mapCameraError(err)));
    retryBtn.hidden = false;
    batchControls.hidden = true;
  }
}

async function onFilePicked(file) {
  if (!file) return;
  clearResult();
  setStatus('Scanning image…');
  try {
    const data = await scanner.scanFile(file);
    handleDecoded(data, { source: 'file' });
  } catch (err) {
    // qr-scanner throws NotFoundException for "no code detected", but for some
    // inputs (e.g. tiny/blank images) it throws a generic error. From the
    // user's perspective both mean the same thing: no QR in that image.
    setStatus('No QR code found in that image.');
  } finally {
    fileInput.value = ''; // allow re-picking the same file
  }
}

// ────────────────────────────── Event wiring ──────────────────────────────

retryBtn.addEventListener('click', startCamera);
fileInput.addEventListener('change', (e) => onFilePicked(e.target.files && e.target.files[0]));
clearBtn.addEventListener('click', clearResult);

// Torch toggle
torchBtn.addEventListener('click', async () => {
  const state = scanner.getTorchState();
  if (!state.supported) return;
  const next = !state.on;
  const ok = await scanner.setTorch(next);
  if (ok) {
    torchBtn.textContent = next ? 'Flash off' : 'Flash on';
    torchBtn.setAttribute('aria-pressed', String(next));
  }
});

// Zoom slider
zoomSlider.addEventListener('input', () => {
  zoomValue.textContent = formatZoom(zoomSlider.value);
});
zoomSlider.addEventListener('change', () => {
  scanner.setZoom(Number(zoomSlider.value));
});

// Camera switch — cycle to the next available camera.
switchCamBtn.addEventListener('click', async () => {
  if (cameraList.length < 2) return;
  cameraIndex = (cameraIndex + 1) % cameraList.length;
  const cam = cameraList[cameraIndex];
  setStatus('Switching camera…');
  try {
    await scanner.setCamera(cam.id);
    refreshDeviceControls();
    setStatus('Point at a QR code');
  } catch (err) {
    setStatus('Could not switch camera: ' + (err && err.message ? err.message : 'unknown error'));
  }
});

// Batch mode toggle
batchToggle.addEventListener('change', () => {
  const on = batchToggle.checked;
  batchViewBtn.hidden = !on;
  batchToggle.setAttribute('aria-checked', String(on));
  if (on) {
    clearResult();
    setStatus(`Batch mode on — ${batchItems.length} in batch`);
    updateBatchBadge();
  } else {
    setStatus(batchItems.length ? `Batch paused — ${batchItems.length} saved` : 'Batch mode off');
  }
});

batchViewBtn.addEventListener('click', openBatchView);
batchClose.addEventListener('click', () => {
  batchView.hidden = true;
});
batchExport.addEventListener('click', () => {
  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'qr-scanner-pwa',
      kind: 'batch',
      count: batchItems.length,
      scans: batchItems.map(({ content, type, label, scannedAt }) => ({ content, type, label, scannedAt })),
    },
    null,
    2,
  );
  downloadBlob(`qr-batch-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
});
batchClear.addEventListener('click', () => {
  if (batchItems.length === 0) return;
  if (!confirm('Clear all scans from this batch?')) return;
  batchItems.length = 0;
  batchSeen.clear();
  updateBatchBadge();
  renderBatch();
  setStatus('Batch cleared');
});

// History events
historyBtn.addEventListener('click', openHistory);
historyClose.addEventListener('click', closeHistory);
// Escape closes whichever full-screen overlay is open (history on top of batch).
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!historyView.hidden) closeHistory();
  else if (!batchView.hidden) batchView.hidden = true;
});
historySearch.addEventListener('input', renderHistory);
historyFilter.addEventListener('change', renderHistory);
historyEnabled.addEventListener('change', () => {
  history.setHistoryEnabled(historyEnabled.checked);
  setStatus(historyEnabled.checked ? 'History saving on' : 'History saving off');
});
historyExport.addEventListener('click', async () => {
  try {
    const json = await history.exportScans();
    downloadBlob(
      `qr-history-${new Date().toISOString().slice(0, 10)}.json`,
      json,
      'application/json',
    );
  } catch {
    setStatus('Export failed.');
  }
});

historyExportCsv.addEventListener('click', async () => {
  try {
    const csv = await history.exportScansCsv();
    // BOM so Excel opens UTF-8 content (e.g. non-ASCII QR payloads) correctly.
    downloadBlob(
      `qr-history-${new Date().toISOString().slice(0, 10)}.csv`,
      '\uFEFF' + csv,
      'text/csv;charset=utf-8',
    );
  } catch {
    setStatus('Export failed.');
  }
});

// Import merges a previously exported JSON file back into history (deduped by
// content+timestamp), enabling device-to-device moves without a server.
historyImport.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files && importInput.files[0];
  importInput.value = ''; // allow re-picking the same file
  if (!file) return;
  try {
    const text = await file.text();
    const added = await history.importScans(JSON.parse(text));
    await Promise.all([renderHistory(), refreshHistoryCount()]);
    setStatus(added > 0 ? `Imported ${added} scan${added === 1 ? '' : 's'}` : 'Nothing new to import.');
  } catch {
    setStatus('Import failed — expected a JSON export from this app.');
  }
});
historyClear.addEventListener('click', async () => {
  if (!confirm('Delete all scans from this device? This cannot be undone.')) return;
  try {
    await history.clearAllScans();
    await Promise.all([renderHistory(), refreshHistoryCount()]);
    setStatus('History cleared');
  } catch {
    setStatus('Could not clear history.');
  }
});

// Register service worker for offline / installability.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support non-critical */
    });
  });
}

// ────────────────────────────── Install prompt ──────────────────────────────
// Show a custom install banner on first visit. Captures beforeinstallprompt
// (Chromium/Android) and falls back to "Add to Home Screen" instructions on iOS
// Safari, which never fires the event. Permanently dismissible via localStorage.

const INSTALL_DISMISS_KEY = 'qr.install.dismissed';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes a non-standard flag.
    window.navigator.standalone === true
  );
}

function isIOSSafari() {
  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  // Exclude Chrome/Firefox on iOS (they're WebKit but don't support Add to Home
  // Screen the same way; they also don't fire beforeinstallprompt).
  return isIOS && !/crios|fxios/i.test(ua);
}

function isInstallDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  } catch {
    /* private mode / unavailable */
    return false;
  }
}

function setInstallDismissed() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, '1');
  } catch {
    /* ignore */
  }
}

function showInstall({ ios }) {
  if (installPrompt.hidden === false) return;
  installPrompt.classList.toggle('install--ios', ios);
  installBtn.hidden = ios;
  installHint.hidden = ios;
  installIos.hidden = !ios;
  installPrompt.hidden = false;
}

function hideInstall() {
  installPrompt.hidden = true;
}

let deferredPrompt = null;
const iosMode = isIOSSafari();

// Don't bother wiring anything if already installed or permanently dismissed.
if (!isStandalone() && !isInstallDismissed()) {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chrome's default mini-infobar in favour of our banner.
    e.preventDefault();
    deferredPrompt = e;
    showInstall({ ios: false });
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        setInstallDismissed();
      }
    } catch {
      /* user dismissed the native dialog */
    }
    deferredPrompt = null;
    hideInstall();
  });

  installDismiss.addEventListener('click', () => {
    setInstallDismissed();
    hideInstall();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setInstallDismissed();
    hideInstall();
  });

  // iOS Safari never fires beforeinstallprompt — surface manual instructions
  // once the page is interactive.
  if (iosMode) {
    const showIosInstructions = () => showInstall({ ios: true });
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', showIosInstructions, { once: true });
    } else {
      showIosInstructions();
    }
  }
}

// Init: sync count badge + version + auto-start the camera.
initVersionBadge();
refreshHistoryCount();
startCamera();

// ────────────────────────────── Version badge ──────────────────────────────
// Reads the version from the PWA manifest (kept in sync with package.json via
// `npm run bump`) and shows it quietly in the History header. Tapping the
// badge copies "QR Scanner <version>" and confirms by flashing the badge
// green — feedback lives on the control itself, not in the camera status bar,
// which the bottom sheet can cover.

async function initVersionBadge() {
  try {
    const res = await fetch('./manifest.webmanifest');
    const manifest = await res.json();
    if (manifest && manifest.version) {
      appVersion.querySelector('.version__num').textContent = manifest.version;
      appVersion.hidden = false;
    }
  } catch {
    /* offline-first failure or malformed manifest — badge simply stays hidden */
  }
}

let versionCopyTimer = null;

appVersion.addEventListener('click', async () => {
  const v = appVersion.querySelector('.version__num').textContent;
  if (!v) return;
  try {
    await navigator.clipboard.writeText(`QR Scanner v${v}`);
  } catch {
    /* clipboard blocked — still flash so the tap isn't a dead end */
  }
  appVersion.classList.add('version--copied');
  appVersion.setAttribute('aria-label', `Copied version ${v}`);
  if (navigator.vibrate) navigator.vibrate(15);
  clearTimeout(versionCopyTimer);
  versionCopyTimer = setTimeout(() => {
    appVersion.classList.remove('version--copied');
    appVersion.removeAttribute('aria-label');
  }, 1200);
});
