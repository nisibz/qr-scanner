import { useState } from 'react'
import { useApp } from '@/state/AppContext'
import { cn } from '@/lib/utils'
import type { ParsedAction } from '@/lib/app'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
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

/**
 * Bottom sheet showing one decoded QR result.
 *
 * A second Radix Dialog, NOT a manual portal: Radix's DismissableLayer
 * stacks nested layers correctly (inner dismisses first, outer stays),
 * which is exactly the relationship between this sheet and the History
 * sheet. All the z-index / stopPropagation / pointer-events patching the
 * manual approach needed disappears — the primitives handle it.
 */
export function ResultSheet() {
  const { state, actions } = useApp()
  const { result, status } = state

  return (
    <Sheet open={result != null} onOpenChange={(open) => { if (!open) actions.clearResult() }}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-label="Scan result"
        className="mx-auto w-[calc(100%-20px)] max-w-md max-h-[72dvh] overflow-y-auto rounded-xl border bg-card p-4 gap-3 bottom-[calc(10px+env(safe-area-inset-bottom))] top-auto left-1/2 right-auto -translate-x-1/2 translate-y-0 data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom"
      >
        <SheetTitle className="sr-only">Scan result</SheetTitle>
        <p className="text-[0.72rem] font-medium uppercase tracking-widest text-muted-foreground">
          {result?.label || 'Decoded'}
        </p>

        {result && (
          <>
            <p className="break-words text-base leading-relaxed">{result.title}</p>

            {result.fields.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {result.fields.map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="font-medium text-muted-foreground">{f.label}</dt>
                    <dd className={cn('break-words', f.monospace && 'font-mono text-[0.9em]')}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {result.safety && !result.safety.isSafe && (
              <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-sm text-orange-200">
                <strong>Heads up — </strong>
                {result.safety.reasons.join('; ')}.
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-2.5">
              {result.actions.map((a) => (
                <ActionButton key={a.label} action={a} onStatus={actions.setStatus} />
              ))}
            </div>

            <Button variant="ghost" className="mt-1 w-full" onClick={() => actions.clearResult()}>
              Dismiss
            </Button>
            <span className="sr-only" role="status">{status}</span>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
