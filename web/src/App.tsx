import { useState } from 'react'
import { AppProvider, useApp } from '@/state/AppContext'
import { ScannerView } from '@/components/ScannerView'
import { ResultSheet } from '@/components/ResultSheet'
import { HistorySheet } from '@/components/HistorySheet'
import { Badge } from '@/components/ui/badge'

function Header() {
  const { state } = useApp()
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">QR Scanner</h1>
        <p className="mt-1 text-sm text-muted-foreground">Scan with your camera or an image</p>
      </div>
      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        aria-label="Open scan history"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-semibold active:bg-border"
      >
        History
        {state.historyCount > 0 && (
          <Badge className="min-w-5 rounded-full px-1.5 py-0 text-[0.7rem] font-bold">
            {state.historyCount > 99 ? '99+' : state.historyCount}
          </Badge>
        )}
      </button>
      <HistorySheet open={historyOpen} onOpenChange={setHistoryOpen} />
    </header>
  )
}

function Shell() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-10 pt-5">
      <Header />
      <ScannerView />
      <ResultSheet />
    </main>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
