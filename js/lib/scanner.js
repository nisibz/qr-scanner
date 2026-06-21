// Thin wrapper around the vendored qr-scanner library.
// Isolates camera lifecycle + file scanning so the rest of the app
// (and future phases) doesn't depend on QrScanner internals.
import QrScanner from '../../vendor/qr-scanner.min.js';

// Set the worker path explicitly so it resolves regardless of where the
// page is hosted (e.g. Cloudflare Pages subpaths).
QrScanner.WORKER_PATH = new URL('../../vendor/qr-scanner-worker.min.js', import.meta.url).href;

/**
 * ScannerError carries a stable `name` (e.g. 'NoCamera', 'NotAllowedError',
 * 'InsecureContext') so callers can render friendly messages without parsing
 * raw exception text.
 */
export class ScannerError extends Error {
  constructor(name, message) {
    super(message);
    this.name = name;
  }
}

export async function hasCamera() {
  try {
    return await QrScanner.hasCamera();
  } catch {
    return false;
  }
}

/**
 * Create a scanner bound to a <video> element.
 * @param {{video: HTMLVideoElement, onResult?: (text: string) => void}} opts
 * @returns {{
 *   start: () => Promise<void>,
 *   stop: () => Promise<void>,
 *   scanFile: (file: Blob) => Promise<string>,
 *   destroy: () => void,
 *   getRaw: () => (QrScanner | null),
 *   getActiveTrack: () => (MediaStreamTrack | null),
 *   getTorchState: () => { supported: boolean, on?: boolean },
 *   setTorch: (on: boolean) => Promise<boolean>,
 *   getZoomState: () => { supported: boolean, min?: number, max?: number, step?: number, current?: number },
 *   setZoom: (level: number) => Promise<boolean>,
 *   listCameras: () => Promise<Array<{ id: string, label: string }>>,
 *   setCamera: (deviceId: string) => Promise<void>,
 * }}
 */
export function createScanner({ video, onResult } = {}) {
  if (!video) throw new Error('createScanner: video element required');

  let scanner = null;
  let started = false;

  function ensure() {
    if (scanner) return scanner;
    scanner = new QrScanner(
      video,
      (res) => {
        const data = typeof res === 'string' ? res : (res && res.data) || '';
        if (onResult) onResult(data);
      },
      {
        preferredCamera: 'environment',
        highlightScanRegion: true,
        highlightCodeOutline: true,
        maxScansPerSecond: 10,
        onDecodeError: () => {
          /* ignore transient "no code" frames */
        },
      },
    );
    return scanner;
  }

  function getActiveTrack() {
    const stream = video.srcObject;
    if (!stream) return null;
    const tracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
    return tracks[0] || null;
  }

  return {
    async start() {
      if (!window.isSecureContext) {
        throw new ScannerError('InsecureContext', 'Camera needs a secure context (localhost or HTTPS).');
      }
      if (!(await hasCamera())) {
        throw new ScannerError('NoCamera', 'No camera found on this device.');
      }
      const s = ensure();
      await s.start();
      started = true;
    },
    async stop() {
      if (scanner && started) {
        scanner.stop();
        started = false;
      }
    },
    async scanFile(file) {
      const res = await QrScanner.scanImage(file);
      return typeof res === 'string' ? res : (res && res.data) || '';
    },
    destroy() {
      if (scanner) {
        scanner.destroy();
        scanner = null;
        started = false;
      }
    },
    getRaw() {
      return scanner;
    },
    getActiveTrack,

    // ── Torch (flashlight) ──
    getTorchState() {
      const track = getActiveTrack();
      if (!track || !track.getCapabilities) return { supported: false };
      const caps = track.getCapabilities();
      if (!caps || !caps.torch) return { supported: false };
      const settings = track.getSettings ? track.getSettings() : {};
      return { supported: true, on: !!settings.torch };
    },
    async setTorch(on) {
      const track = getActiveTrack();
      if (!track || !track.applyConstraints) return false;
      const caps = track.getCapabilities && track.getCapabilities();
      if (!caps || !caps.torch) return false;
      try {
        await track.applyConstraints({ advanced: [{ torch: !!on }] });
        return true;
      } catch {
        return false;
      }
    },

    // ── Zoom ──
    getZoomState() {
      const track = getActiveTrack();
      if (!track || !track.getCapabilities) return { supported: false };
      const caps = track.getCapabilities();
      if (!caps || !caps.zoom) return { supported: false };
      const settings = track.getSettings ? track.getSettings() : {};
      return {
        supported: true,
        min: caps.zoom.min,
        max: caps.zoom.max,
        step: caps.zoom.step || 1,
        current: settings.zoom != null ? settings.zoom : caps.zoom.min,
      };
    },
    async setZoom(level) {
      const track = getActiveTrack();
      if (!track || !track.applyConstraints) return false;
      try {
        await track.applyConstraints({ advanced: [{ zoom: level }] });
        return true;
      } catch {
        return false;
      }
    },

    // ── Camera enumeration / switching ──
    async listCameras() {
      try {
        const cams = await QrScanner.getCameras();
        return (cams || []).map((c) => ({ id: c.id, label: c.label }));
      } catch {
        return [];
      }
    },
    async setCamera(deviceId) {
      const s = ensure();
      // qr-scanner accepts a deviceId or a facingMode string.
      await s.setCamera(deviceId);
    },
  };
}

/**
 * Map a raw exception (from scanner.start or scanImage) into a ScannerError
 * with a stable name. Already-typed ScannerError instances pass through.
 */
export function mapCameraError(err) {
  if (!err) return new ScannerError('Unknown', 'unknown error');
  if (err instanceof ScannerError) return err;
  if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
    return new ScannerError(err.name, 'Camera permission denied.');
  }
  if (err.name === 'NotFoundError') {
    return new ScannerError(err.name, 'No camera found.');
  }
  if (err.name === 'NotReadableError') {
    return new ScannerError(err.name, 'Camera is in use by another app.');
  }
  return new ScannerError(err.name || 'Unknown', err.message || 'unknown error');
}
