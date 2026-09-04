// The vendored qr-scanner bundle ships no types; this is the surface we use.
declare module '*qr-scanner.min.js' {
  interface ScanResult {
    data: string;
  }
  class QrScanner {
    static WORKER_PATH: string;
    constructor(
      video: HTMLVideoElement,
      onResult: (result: string | ScanResult) => void,
      opts?: Record<string, unknown>,
    );
    static hasCamera(): Promise<boolean>;
    static scanImage(image: Blob): Promise<string | ScanResult>;
    static listCameras(): Promise<Array<{ id: string; label: string }>>;
    start(): Promise<void>;
    stop(): void;
    destroy(): void;
    setCamera(deviceId: string): Promise<void>;
  }
  export default QrScanner;
}
