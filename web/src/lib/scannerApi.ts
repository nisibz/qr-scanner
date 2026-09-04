// Standalone file-scan helper: QrScanner.scanImage works without a camera
// instance, so the file picker doesn't need the shared scanner handle.
import QrScanner from '../../vendor/qr-scanner.min.js'

export const scanner = {
  async scanFile(file: Blob): Promise<string> {
    const res = await QrScanner.scanImage(file)
    return typeof res === 'string' ? res : (res && res.data) || ''
  },
}
