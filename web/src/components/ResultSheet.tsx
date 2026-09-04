import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '@/state/AppContext'
import { cn } from '@/lib/utils'
import type { ParsedAction } from '@/lib/app'
import { Button } from '@/components/ui/button'

function ActionButton({ action, onStatus }: { action: ParsedAction; onStatus: (s: string) => void }) {
  const [copied, setCopied] = useState<null | boolean>(null)

  if (action.kind === 'link') {
    return (
      <Button asChild variant={action.primary ? 'default' : 'ghost'} className="flex-1 min-w-24">
        <a href={action.href} target="_blank" rel="noopener noreferrer">{action.label}</a>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant={action.primary ? 'default' : 'ghost'}
      className={cn('flex-1 min-w-24', copied === true && 'bg-green-500/15 border-green-500 text-green-500', copied === false && 'border-destructive text-destructive')}
      onClick={async () => {
        let ok = false
        try {
          await navigator.clipboard.writeText(action.value ?? '')
          ok = true
        } catch {
          ok = false
        }
        setCopied(ok)
        onStatus(ok ? 'Copied to clipboard' : 'Copy failed')
        if (navigator.vibrate) navigator.vibrate(ok ? 20 : [10, 40, 10])
        setTimeout(() => setCopied(null), 1200)
      }}
    >
      {copied === true ? 'Copied ✓' : copied === false ? 'Copy failed' : action.label}
    </Button>
  )
}

export function ResultSheet() {
  const { state, actions } = useApp()
  const { result, status } = state
  if (!result) return null

  return (
    // Portal above everything (Sheet is z-50): the card owns its own scrim so
    // taps land here, never leak through to the History footer underneath.
    createPortal(
      <div className="fixed inset-0 z-[60]">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
          onClick={() => actions.clearResult()}
        />
        <div
          role="dialog"
          aria-label="Scan result"
          className="absolute inset-x-0 mx-auto w-[calc(100%-20px)] max-w-md max-h-[72dvh] overflow-y-auto rounded-xl border bg-card p-4 shadow-[0_-8px_32px_rgba(0,0,0,0.5)] animate-in slide-in-from-bottom-4 fade-in duration-200"
          style={{ bottom: 'calc(10px + env(safe-area-inset-bottom))' }}
        >
      <p className="text-[0.72rem] uppercase tracking-widest text-muted-foreground">{result.label || 'Decoded'}</p>
      <p className="mt-1 break-words text-base leading-relaxed">{result.title}</p>

      {result.fields.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {result.fields.map((f: { label: string; value: string; monospace?: boolean }) => (
            <div key={f.label} className="contents">
              <dt className="font-medium text-muted-foreground">{f.label}</dt>
              <dd className={cn('break-words', f.monospace && 'font-mono text-[0.9em]')}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {result.safety && !result.safety.isSafe && (
        <div className="mt-3 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-200">
          <strong>Heads up — </strong>
          {result.safety.reasons.join('; ')}.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2.5">
        {result.actions.map((a: ParsedAction) => (
          <ActionButton key={a.label} action={a} onStatus={actions.setStatus} />
        ))}
      </div>

      <Button variant="ghost" className="mt-2 w-full" onClick={() => actions.clearResult()}>
        Dismiss
      </Button>
      <span className="sr-only" role="status">{status}</span>
        </div>
      </div>,
      document.body,
    )
  )
}
