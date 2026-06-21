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
const historyClear = $('historyClear');

// In-memory batch collection (not persisted).
const batchItems = [];
let batchSeen = new Set();
let cameraList = [];
let cameraIndex = 0;

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
}

function renderResult(parsed) {
  resultLabel.textContent = parsed.label || 'Decoded';
  resultText.textContent = parsed.title || '';
  renderFields(parsed.fields || []);
  renderWarning(parsed.safety);
  renderActions(parsed.actions || []);
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    btn.addEventListener('click', () => copyText(a.value));
  } else if (a.kind === 'download') {
    btn.addEventListener('click', () => downloadBlob(a.filename, a.content, a.mime));
  }
  return btn;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus('Copied to clipboard');
    if (navigator.vibrate) navigator.vibrate(20);
  } catch {
    setStatus('Copy failed — select and copy manually.');
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

function handleDecoded(raw) {
  if (!raw) return;
  const parsed = parseResult(raw);

  if (batchToggle.checked) {
    addToBatch(parsed);
    return;
  }

  renderResult(parsed);
  setStatus('Scanned');
  if (navigator.vibrate) navigator.vibrate(40);
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
  handleDecoded(raw);
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
  batchView.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ────────────────────────────── History UI ──────────────────────────────

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

  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'hitem';
    li.dataset.id = it.id;

    const meta = document.createElement('div');
    meta.className = 'hitem__meta';

    const badge = document.createElement('span');
    badge.className = 'hitem__type';
    badge.textContent = it.label || it.type || 'Text';
    meta.appendChild(badge);

    const time = document.createElement('time');
    time.className = 'hitem__time';
    time.dateTime = new Date(it.createdAt).toISOString();
    time.textContent = formatRelativeTime(it.createdAt);
    meta.appendChild(time);

    li.appendChild(meta);

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'hitem__body';
    body.textContent = truncate(it.content, 120);
    body.addEventListener('click', () => viewHistoryItem(it));
    li.appendChild(body);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hitem__del';
    del.setAttribute('aria-label', 'Delete this scan');
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await history.removeScan(it.id);
        await Promise.all([renderHistory(), refreshHistoryCount()]);
      } catch {
        /* ignore */
      }
    });
    li.appendChild(del);

    historyList.appendChild(li);
  }
}

function viewHistoryItem(item) {
  historyView.hidden = true;
  handleDecoded(item.content);
}

function openHistory() {
  historyView.hidden = false;
  historyEnabled.checked = history.isHistoryEnabled();
  renderHistory();
  historyView.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  } catch (err) {
    setStatus(friendlyStatus(mapCameraError(err)));
    retryBtn.hidden = false;
  }
}

async function onFilePicked(file) {
  if (!file) return;
  clearResult();
  setStatus('Scanning image…');
  try {
    const data = await scanner.scanFile(file);
    onDecoded(data);
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

// Init: sync count badge + auto-start the camera.
refreshHistoryCount();
startCamera();
