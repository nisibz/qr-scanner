declare module '@/lib/scanner' {
  export class ScannerError extends Error {
    constructor(name: string, message: string);
  }
  export interface ScannerHandle {
    start(): Promise<void>;
    stop(): Promise<void>;
    scanFile(file: Blob): Promise<string>;
    destroy(): void;
    getRaw(): unknown;
    getActiveTrack(): MediaStreamTrack | null;
    getTorchState(): { supported: boolean; on?: boolean };
    setTorch(on: boolean): Promise<boolean>;
    getZoomState(): { supported: boolean; min?: number; max?: number; step?: number; current?: number };
    setZoom(level: number): Promise<boolean>;
    listCameras(): Promise<Array<{ id: string; label: string }>>;
    setCamera(deviceId: string): Promise<void>;
  }
  export function hasCamera(): Promise<boolean>;
  export function mapCameraError(err: unknown): ScannerError;
  export function createScanner(opts: {
    video: HTMLVideoElement;
    onResult?: (text: string) => void;
  }): ScannerHandle;
}
