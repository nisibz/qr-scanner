import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/state/AppContext'
import { dayLabel, clockTime, rowVisuals, type HistoryRecord } from '@/lib/app'
import { parseResult } from '@/lib/result-parser'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import * as historyStore from '@/lib/history-store'
import { cn } from '@/lib/utils'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'url', label: 'URL' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'contact', label: 'Contact' },
  { value: 'text', label: 'Text' },
] as const

// Types that fold into the "Contact" chip.
const CONTACT_TYPES = new Set(['vcard', 'mecard'])

interface SwipeState {
  id: number | null
  dx: number
  dragging: boolean
}

export function HistorySheet({
  open, onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { state, actions } = useApp()
  const { history } = state
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [saveEnabled, setSaveEnabled] = useState(historyStore.isHistoryEnabled())
  const [swipe, setSwipe] = useState<SwipeState>({ id: null, dx: 0, dragging: false })
  const [confirmDelete, setConfirmDelete] = useState<HistoryRecord | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const startX = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [version, setVersion] = useState('')
  useEffect(() => {
    fetch('./manifest.webmanifest').then((r) => r.json()).then((m) => setVersion('v' + m.version)).catch(() => {})
  }, [])

  // Content → saved page title (URLs fetched at scan time).
  const titles = useMemo(
    () => new Map(history.filter((h) => h.title).map((h) => [h.content, h.title as string])),
    [history],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return history.filter((it) => {
      if (filter === 'contact' ? !CONTACT_TYPES.has(it.type) : filter !== 'all' && it.type !== filter) return false
      if (q && !it.content.toLowerCase().includes(q)) return false
      return true
    })
  }, [history, search, filter])

  // Group by day for section headers.
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: HistoryRecord[] }> = []
    for (const it of filtered) {
      const day = dayLabel(it.createdAt)
      const last = out[out.length - 1]
      if (last && last.day === day) last.items.push(it)
      else out.push({ day, items: [it] })
    }
    return out
  }, [filtered])

  const onFileImport = async (file: File | undefined) => {
    if (!file) return
    try {
      const json = JSON.parse(await file.text())
      await actions.importScans(json)
    } catch {
      actions.setStatus('Import failed — expected a JSON export from this app.')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="inset-0 h-full max-w-lg mx-auto rounded-none border-0 p-0 flex flex-col bg-background sm:max-w-lg sm:rounded-none">
        <SheetHeader className="flex-row items-center justify-between space-y-0 px-5 pt-5 pb-2">
          <SheetTitle className="text-xl">History</SheetTitle>
          <div className="flex items-center gap-2">
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-full text-base leading-none" aria-label="History options">
                  ⋯
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-sm">Save scans on this device</span>
                  <Switch
                    checked={saveEnabled}
                    onCheckedChange={(v) => {
                      setSaveEnabled(v)
                      historyStore.setHistoryEnabled(v)
                      actions.setStatus(v ? 'History saving on' : 'History saving off')
                    }}
                  />
                </div>
                <div className="mx-2 my-1 border-t" />
                <div className="flex items-center justify-between px-2 py-1.5 text-sm text-muted-foreground">
                  <span>Version</span>
                  <span className="tabular-nums" data-testid="version">{version}</span>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" className="h-8 rounded-full px-3 text-sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        </SheetHeader>

        {/* Segmented filter chips — one tap to the common types. */}
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-2" role="tablist" aria-label="Filter by type">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                filter === f.value
                  ? 'border-accent bg-accent text-white'
                  : 'border-border bg-card text-muted-foreground active:bg-border',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="px-4 pb-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history"
            className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
        </div>

        <ul className="flex-1 overflow-y-auto px-2 pb-2">
          {groups.length === 0 && (
            <li className="p-10 text-center text-sm text-muted-foreground">No matching scans.</li>
          )}
          {groups.map((g) => (
            <li key={g.day}>
              <div className="px-3 pb-1 pt-4 text-[0.7rem] font-bold uppercase tracking-widest text-muted-foreground" aria-hidden="true">
                {g.day}
              </div>
              <ul>
                {g.items.map((it) => {
                  const { icon, title, sub } = rowVisuals(it.type, it.content, titles)
                  const isSwiped = swipe.id === it.id && swipe.dx < 0
                  return (
                    <li key={it.id} className="relative overflow-hidden rounded-xl">
                      {/* Reveal behind: red delete affordance */}
                      <button
                        type="button"
                        aria-label="Delete this scan"
                        className={cn(
                          'absolute inset-y-1 right-1 z-0 w-20 rounded-lg bg-destructive/90 text-sm font-semibold text-white transition-opacity',
                          isSwiped && swipe.dx < -40 ? 'opacity-100' : 'opacity-0',
                        )}
                        onClick={() => it.id != null && setConfirmDelete(it)}
                      >
                        Delete
                      </button>
                      <div
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'relative z-10 flex items-center gap-3 rounded-xl bg-background px-3 py-1.5',
                          isSwiped ? 'shadow-md' : '',
                        )}
                        style={isSwiped ? { transform: `translateX(${Math.max(swipe.dx, -88)}px)` } : undefined}
                        onTouchStart={(e) => {
                          startX.current = e.touches[0].clientX
                          setSwipe({ id: it.id ?? null, dx: 0, dragging: true })
                        }}
                        onTouchMove={(e) => {
                          if (startX.current == null || it.id == null) return
                          const dx = Math.min(0, e.touches[0].clientX - startX.current)
                          setSwipe({ id: it.id, dx, dragging: true })
                        }}
                        onTouchEnd={(e) => {
                          if (startX.current == null || it.id == null) return
                          const dx = e.changedTouches[0].clientX - startX.current
                          startX.current = null
                          // Snap open past -48 to reveal Delete; snap closed otherwise. Never auto-delete.
                          setSwipe({ id: it.id, dx: dx < -48 ? -88 : 0, dragging: false })
                        }}
                        onClick={() => {
                          // A swipe gesture shouldn't trigger the row action.
                          if (isSwiped) return
                          if (it.id != null) {
                            const rec = it
                            // Keep History open underneath — the result sheet
                            // layers on top (higher z-index); dismissing
                            // returns straight to the list, no camera jump.
                            actions.showResult(parseResult(rec.content))
                          }
                        }}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border bg-card" aria-hidden="true">
                          <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] stroke-accent" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d={icon} />
                          </svg>
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[0.92rem] font-medium">{title}</span>
                          <span className="text-[0.74rem] text-muted-foreground">{sub}</span>
                        </span>
                        <time dateTime={new Date(it.createdAt).toISOString()} className="shrink-0 self-start pt-2 text-[0.72rem] tabular-nums text-muted-foreground">
                          {clockTime(it.createdAt)}
                        </time>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>

        <div className="flex justify-center gap-2 border-t px-4 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2">
          {/* Export: one button, format chosen in the menu — most people use
              one format; two permanent buttons were visual noise. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="text-muted-foreground">
                <span aria-hidden="true">↓</span> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center">
              <DropdownMenuItem onClick={() => void exportJson(history)}>Export JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportCsv(history)}>Export CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" className="text-muted-foreground" onClick={() => fileInput.current?.click()}>
            <span aria-hidden="true">↑</span> Import
          </Button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFileImport(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </SheetContent>

      <AlertDialog open={confirmDelete != null} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this scan?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && rowVisuals(confirmDelete.type, confirmDelete.content).title}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete?.id != null) void actions.deleteScan(confirmDelete.id)
                setConfirmDelete(null)
                setSwipe({ id: null, dx: 0, dragging: false })
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}

async function exportJson(history: HistoryRecord[]) {
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), app: 'qr-scanner-pwa', count: history.length, scans: history }, null, 2)
  download(`qr-history-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json')
}

async function exportCsv(history: HistoryRecord[]) {
  const header = 'content,type,label,title,scannedAt'
  const rows = history.map((it) =>
    [it.content, it.type, it.label, it.title ?? '', new Date(it.createdAt).toISOString()].map(csvField).join(','),
  )
  download(`qr-history-${new Date().toISOString().slice(0, 10)}.csv`, '\uFEFF' + [header, ...rows].join('\r\n'), 'text/csv;charset=utf-8')
}

function csvField(value: string) {
  const s = String(value ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
