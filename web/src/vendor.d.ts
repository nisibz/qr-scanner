declare module '*/qr-scanner.min.js' {
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
    start(): Promise<void>;
    stop(): void;
    destroy(): void;
  }
  export default QrScanner;
}

declare module '*/qr-scanner-worker.min.js';
