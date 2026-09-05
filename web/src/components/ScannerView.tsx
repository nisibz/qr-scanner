import { useRef } from 'react'
import { useApp } from '@/state/AppContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function ScannerView() {
  const { state, actions, videoRef } = useApp()
  const { status, cameraReady, batchMode, batch } = state
  const fileInput = useRef<HTMLInputElement>(null)

  // batch length is derived state — render it directly, no mirror useState
  // (per vercel-react-best-practices: rerender-derived-state-no-effect).

  return (
    <section className="flex flex-col gap-3.5" aria-label="Scanner">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border bg-black">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        {cameraReady && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-[68%] w-[68%] rounded-2xl border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 min-h-[1.2em] bg-gradient-to-t from-black/75 to-transparent p-2.5 text-center text-sm" role="status" aria-live="polite">
          {status}
        </div>
      </div>

      {cameraReady && (
        <div className="flex gap-2.5">
          <label className="inline-flex flex-1 cursor-pointer">
            <input
              type="checkbox"
              className="peer absolute h-0 w-0 opacity-0"
              checked={batchMode}
              onChange={(e) => actions.setBatchMode(e.target.checked)}
            />
            <span className={cn(
              'inline-flex w-full items-center justify-center rounded-xl border px-4 py-3 text-[0.95rem] font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent',
              batchMode ? 'border-accent bg-accent text-white' : 'bg-transparent',
            )}>
              Batch mode
            </span>
          </label>
          {batchMode && (
            <Button variant="outline" className="rounded-full px-4" disabled={batch.length === 0}>
              Batch <Badge className="rounded-full px-1.5">{batch.length}</Badge>
            </Button>
          )}
        </div>
      )}

      <label className="block">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            actions.setStatus('Scanning image…')
            const { scanner } = await import('@/lib/scannerApi')
            try {
              const data = await scanner.scanFile(file)
              actions.handleDecoded(data, 'file')
            } catch {
              actions.setStatus('No QR code found in that image.')
            }
          }}
        />
        <span className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl border px-4 py-3 text-[0.95rem] font-semibold">
          Scan an image file
        </span>
      </label>
    </section>
  )
}
