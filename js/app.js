import QrScanner from '../vendor/qr-scanner.min.js';

// qr-scanner auto-loads its worker relative to this module; set the path explicitly
// so it resolves correctly regardless of where the page is hosted (e.g. Cloudflare Pages).
QrScanner.WORKER_PATH = new URL('../vendor/qr-scanner-worker.min.js', import.meta.url).href;

const $ = (id) => document.getElementById(id);

const video = $('video');
const overlay = $('overlay');
const status = $('status');
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const fileInput = $('fileInput');
const result = $('result');
const resultText = $('resultText');
const copyBtn = $('copyBtn');
const openBtn = $('openBtn');
const clearBtn = $('clearBtn');

let scanner = null;

const URL_RE = /^https?:\/\/[^\s]+$/i;

function setStatus(msg) {
  status.textContent = msg || '';
}

function showResult(text) {
  resultText.textContent = text;
  const isUrl = URL_RE.test(text.trim());
  openBtn.hidden = !isUrl;
  if (isUrl) openBtn.href = text.trim();
  result.hidden = false;
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearResult() {
  result.hidden = true;
  resultText.textContent = '';
}

function onDecoded(text) {
  if (!text) return;
  setStatus('Scanned');
  showResult(text);
  // Brief haptic feedback on supported devices.
  if (navigator.vibrate) navigator.vibrate(40);
}

async function startCamera() {
  clearResult();
  startBtn.disabled = true;
  setStatus('Starting camera…');

  try {
    const hasCamera = await QrScanner.hasCamera();
    if (!hasCamera) {
      setStatus('No camera found on this device.');
      startBtn.disabled = false;
      return;
    }

    if (!scanner) {
      scanner = new QrScanner(
        video,
        (res) => onDecoded(res.data || res),
        {
          preferredCamera: 'environment',
          highlightScanRegion: true,
          highlightCodeOutline: true,
          maxScansPerSecond: 10,
          onDecodeError: () => { /* ignore transient "no code" frames */ },
        },
      );
    }

    await scanner.start();
    overlay.hidden = false;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    setStatus('Point at a QR code');
  } catch (err) {
    handleCameraError(err);
    startBtn.disabled = false;
  }
}

function stopCamera() {
  if (scanner) scanner.stop();
  overlay.hidden = true;
  startBtn.hidden = false;
  stopBtn.hidden = true;
  startBtn.disabled = false;
  setStatus('');
}

function handleCameraError(err) {
  if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    setStatus('Camera permission denied. Allow access or scan an image instead.');
  } else if (err && err.name === 'NotFoundError') {
    setStatus('No camera found. Try scanning an image instead.');
  } else if (err && err.name === 'NotReadableError') {
    setStatus('Camera is in use by another app. Close it and retry.');
  } else {
    setStatus('Could not start camera: ' + (err && err.message ? err.message : 'unknown error'));
  }
}

async function onFilePicked(file) {
  if (!file) return;
  clearResult();
  setStatus('Scanning image…');
  try {
    const result = await QrScanner.scanImage(file);
    // scanImage may return either a string or a detailed result object depending on version/options.
    const data = typeof result === 'string' ? result : (result && result.data) || '';
    onDecoded(data);
  } catch (err) {
    if (err && err.name === 'NotFoundException') {
      setStatus('No QR code found in that image.');
    } else {
      setStatus('Could not read image: ' + (err && err.message ? err.message : 'unknown error'));
    }
  } finally {
    fileInput.value = ''; // allow re-picking the same file
  }
}

// Wire up events
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);
fileInput.addEventListener('change', (e) => onFilePicked(e.target.files && e.target.files[0]));
clearBtn.addEventListener('click', clearResult);

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultText.textContent);
    setStatus('Copied to clipboard');
  } catch {
    setStatus('Copy failed — select and copy manually.');
  }
});

// Register service worker for offline / installability.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support non-critical */ });
  });
}
