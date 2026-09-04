import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createScanner, type ScannerHandle } from '@/lib/scanner'
import { parseResult } from '@/lib/result-parser'
import type { ParsedResult } from '@/lib/app'
import * as historyStore from '@/lib/history-store'
import type { HistoryRecord } from '@/lib/app'

interface AppState {
  status: string
  result: ParsedResult | null
  history: HistoryRecord[]
  historyCount: number
  batch: ParsedResult[]
  batchMode: boolean
  cameraReady: boolean
}

interface AppActions {
  setStatus: (s: string) => void
  showResult: (parsed: ParsedResult) => void
  clearResult: () => void
  handleDecoded: (raw: string, source: 'camera' | 'file' | 'history') => void
  refreshHistory: () => Promise<void>
  deleteScan: (id: number) => Promise<void>
  clearHistory: () => Promise<void>
  importScans: (json: unknown) => Promise<number>
  setBatchMode: (on: boolean) => void
  addToBatch: (parsed: ParsedResult) => void
  removeFromBatch: (content: string) => void
  clearBatch: () => void
}

const AppContext = createContext<{ state: AppState; actions: AppActions; videoRef: React.RefObject<HTMLVideoElement | null> } | null>(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

let batchSeen = new Set<string>()

export function AppProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const scannerRef = useRef<ScannerHandle | null>(null)
  const lastCameraRaw = useRef<string | null>(null)
  const lastRenderedRaw = useRef<string | null>(null)

  const [status, setStatus] = useState('Starting camera…')
  const [result, setResult] = useState<ParsedResult | null>(null)
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [historyCount, setHistoryCount] = useState(0)
  const [batch, setBatch] = useState<ParsedResult[]>([])
  const [batchMode, setBatchModeState] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)

  const refreshHistory = useCallback(async () => {
    try {
      const [items, count] = await Promise.all([
        historyStore.queryScans({}),
        historyStore.countScans(),
      ])
      setHistory(items)
      setHistoryCount(count)
    } catch {
      /* private mode */
    }
  }, [])

  const buzz = (ms: number | number[]) => navigator.vibrate && navigator.vibrate(ms)

  const showResult = useCallback((parsed: ParsedResult) => {
    const isNew = parsed.raw !== lastRenderedRaw.current
    lastRenderedRaw.current = parsed.raw
    setResult(parsed)
    if (isNew) buzz(40)
  }, [])

  const clearResult = useCallback(() => {
    setResult(null)
    lastRenderedRaw.current = null
    lastCameraRaw.current = null
  }, [])

  const handleDecoded = useCallback((raw: string, source: 'camera' | 'file' | 'history') => {
    if (!raw) return
    const parsed = parseResult(raw)

    if (batchMode) {
      if (batchSeen.has(parsed.raw)) {
        setStatus(`Already in batch (${batch.length})`)
        buzz(15)
        return
      }
      batchSeen.add(parsed.raw)
      setBatch((b) => [...b, parsed])
      setStatus(`Added to batch (${batch.length + 1})`)
      buzz(40)
      return
    }

    showResult(parsed)
    setStatus('Scanned')
    if (source === 'history') return
    if (source === 'camera') {
      if (raw === lastCameraRaw.current) return
      lastCameraRaw.current = raw
    }
    historyStore
      .addScan({ content: parsed.raw, type: parsed.type, label: parsed.label })
      .then((rec) => {
        if (rec) void refreshHistory()
      })
      .catch(() => {})
  }, [batchMode, batch.length, refreshHistory, showResult])

  const deleteScan = useCallback(async (id: number) => {
    try {
      await historyStore.removeScan(id)
      await refreshHistory()
      setStatus('Deleted')
    } catch { /* ignore */ }
  }, [refreshHistory])

  const clearHistory = useCallback(async () => {
    try {
      await historyStore.clearAllScans()
      await refreshHistory()
      setStatus('History cleared')
    } catch { /* ignore */ }
  }, [refreshHistory])

  const importScans = useCallback(async (json: unknown) => {
    const added = await historyStore.importScans(json)
    await refreshHistory()
    setStatus(added > 0 ? `Imported ${added} scan${added === 1 ? '' : 's'}` : 'Nothing new to import.')
    return added
  }, [refreshHistory])

  const setBatchMode = useCallback((on: boolean) => {
    setBatchModeState(on)
    if (on) {
      clearResult()
      setStatus(`Batch mode on — ${batch.length} in batch`)
    } else {
      setStatus(batch.length ? `Batch paused — ${batch.length} saved` : 'Batch mode off')
    }
  }, [batch.length, clearResult])

  const addToBatch = useCallback((parsed: ParsedResult) => {
    if (batchSeen.has(parsed.raw)) return
    batchSeen.add(parsed.raw)
    setBatch((b) => [...b, parsed])
  }, [])

  const removeFromBatch = useCallback((content: string) => {
    setBatch((b) => {
      const next = b.filter((x) => x.raw !== content)
      batchSeen = new Set(next.map((x) => x.raw))
      return next
    })
  }, [])

  const clearBatch = useCallback(() => {
    setBatch([])
    batchSeen.clear()
  }, [])

  // Camera lifecycle — mount/unmount.
  useEffect(() => {
    if (!videoRef.current) return
    const scanner = createScanner({ video: videoRef.current, onResult: (raw) => handleDecodedRef.current(raw, 'camera') })
    scannerRef.current = scanner
    let cancelled = false
    ;(async () => {
      try {
        await scanner.start()
        if (cancelled) return
        setCameraReady(true)
        setStatus('Point at a QR code')
      } catch (err) {
        if (cancelled) return
        setStatus(friendlyStatus(err))
      }
    })()
    return () => {
      cancelled = true
      scanner.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep latest handleDecoded without restarting the camera.
  const handleDecodedRef = useRef(handleDecoded)
  handleDecodedRef.current = handleDecoded

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  const actions: AppActions = {
    setStatus,
    showResult,
    clearResult,
    handleDecoded,
    refreshHistory,
    deleteScan,
    clearHistory,
    importScans,
    setBatchMode,
    addToBatch,
    removeFromBatch,
    clearBatch,
  }

  return (
    <AppContext.Provider value={{ state: { status, result, history, historyCount, batch, batchMode, cameraReady }, actions, videoRef }}>
      {children}
    </AppContext.Provider>
  )
}

function friendlyStatus(err: unknown): string {
  const e = err as { name?: string; message?: string }
  switch (e?.name) {
    case 'InsecureContext':
      return 'Camera needs a secure context (localhost or HTTPS). Open the deployed URL or scan an image instead.'
    case 'NoCamera':
      return 'No camera found on this device. Scan an image instead.'
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission denied. Allow access or scan an image instead.'
    case 'NotFoundError':
      return 'No camera found. Try scanning an image instead.'
    case 'NotReadableError':
      return 'Camera is in use by another app. Close it and retry.'
    default:
      return 'Could not start camera: ' + (e?.message || 'unknown error')
  }
}
