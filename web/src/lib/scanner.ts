// Thin wrapper around the vendored qr-scanner library.
// Isolates camera lifecycle + file scanning so the rest of the app
// (and future phases) doesn't depend on QrScanner internals.
import QrScanner from '../../vendor/qr-scanner.min.js';

/**
 * ScannerError carries a stable `name` (e.g. 'NoCamera', 'NotAllowedError',
 * 'InsecureContext') so callers can render friendly messages without parsing
 * raw exception text.
 */
export class ScannerError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** Public surface of the scanner wrapper consumed by the UI layer. */
export interface ScannerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  scanFile(file: Blob): Promise<string>;
  destroy(): void;
  getActiveTrack(): MediaStreamTrack | null;
  getTorchState(): { supported: boolean; on?: boolean };
  setTorch(on: boolean): Promise<boolean>;
  getZoomState(): { supported: boolean; min?: number; max?: number; step?: number; current?: number };
  setZoom(level: number): Promise<boolean>;
  listCameras(): Promise<Array<{ id: string; label: string }>>;
  setCamera(deviceId: string): Promise<void>;
}

interface QrScannerLike {
  start(): Promise<void>;
  stop(): void;
  destroy(): void;
  setCamera(deviceId: string): Promise<void>;
}

interface QrScannerStatic {
  new (
    video: HTMLVideoElement,
    onResult: (result: string | { data: string }) => void,
    opts?: Record<string, unknown>,
  ): QrScannerLike;
  hasCamera(): Promise<boolean>;
  scanImage(image: Blob): Promise<string | { data: string }>;
  listCameras(): Promise<Array<{ id: string; label: string }>>;
}
const QrScannerCtor = QrScanner as unknown as QrScannerStatic;

/**
 * Standalone file scan: QrScanner.scanImage works without a camera instance,
 * so the file picker doesn't need the shared scanner handle.
 */
export async function scanFile(file: Blob): Promise<string> {
  const res = await QrScannerCtor.scanImage(file);
  return typeof res === 'string' ? res : (res && res.data) || '';
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
export function createScanner({ video, onResult }: { video: HTMLVideoElement; onResult?: (text: string) => void }): ScannerHandle {
  if (!video) throw new Error('createScanner: video element required');

  let scanner: QrScannerLike | null = null;
  let started = false;

  function ensure(): QrScannerLike {
    if (scanner) return scanner;
    scanner = new QrScannerCtor(
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

  function getActiveTrack(): MediaStreamTrack | null {
    const stream = video.srcObject as MediaStream | null;
    if (!stream) return null;
    const tracks = stream.getVideoTracks();
    return tracks[0] || null;
  }

  return {
    async start() {
      if (!window.isSecureContext) {
        throw new ScannerError('InsecureContext', 'Camera needs a secure context (localhost or HTTPS).');
      }
      if (!(await QrScannerCtor.hasCamera())) {
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
    async scanFile(file: Blob): Promise<string> {
      const res = await QrScannerCtor.scanImage(file);
      return typeof res === 'string' ? res : (res && res.data) || '';
    },
    destroy() {
      if (scanner) {
        scanner.destroy();
        scanner = null;
        started = false;
      }
    },
    getActiveTrack,

    // ── Torch (flashlight) ──
    getTorchState() {
      const track = getActiveTrack();
      if (!track || !track.getCapabilities) return { supported: false };
      const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
      if (!caps || !caps.torch) return { supported: false };
      const settings = track.getSettings ? (track.getSettings() as { torch?: boolean }) : {};
      return { supported: true, on: !!settings.torch };
    },
    async setTorch(on: boolean): Promise<boolean> {
      const track = getActiveTrack();
      if (!track || !track.applyConstraints) return false;
      const caps = track.getCapabilities && (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean });
      if (!caps || !caps.torch) return false;
      try {
        await track.applyConstraints({ advanced: [{ torch: !!on }] } as unknown as MediaTrackConstraints);
        return true;
      } catch {
        return false;
      }
    },

    // ── Zoom ──
    getZoomState() {
      const track = getActiveTrack();
      if (!track || !track.getCapabilities) return { supported: false };
      const caps = track.getCapabilities() as MediaTrackCapabilities & {
        zoom?: { min: number; max: number; step?: number };
      };
      if (!caps || !caps.zoom) return { supported: false };
      const settings = track.getSettings ? (track.getSettings() as { zoom?: number }) : {};
      return {
        supported: true,
        min: caps.zoom.min,
        max: caps.zoom.max,
        step: caps.zoom.step || 1,
        current: settings.zoom != null ? settings.zoom : caps.zoom.min,
      };
    },
    async setZoom(level: number): Promise<boolean> {
      const track = getActiveTrack();
      if (!track || !track.applyConstraints) return false;
      try {
        await track.applyConstraints({ advanced: [{ zoom: level }] } as unknown as MediaTrackConstraints);
        return true;
      } catch {
        return false;
      }
    },

    // ── Camera enumeration / switching ──
    async listCameras(): Promise<Array<{ id: string; label: string }>> {
      try {
        const cams: Array<{ id: string; label: string }> = await QrScannerCtor.listCameras();
        return cams || [];
      } catch {
        return [];
      }
    },
    async setCamera(deviceId: string): Promise<void> {
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
export function mapCameraError(err: unknown): ScannerError {
  if (!err) return new ScannerError('Unknown', 'unknown error');
  if (err instanceof ScannerError) return err;
  const e = err as { name?: string; message?: string };
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
    return new ScannerError(e.name, 'Camera permission denied.');
  }
  if (e.name === 'NotFoundError') {
    return new ScannerError(e.name, 'No camera found.');
  }
  if (e.name === 'NotReadableError') {
    return new ScannerError(e.name, 'Camera is in use by another app.');
  }
  return new ScannerError(e.name || 'Unknown', e.message || 'unknown error');
}
