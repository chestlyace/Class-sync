'use client'

import { Minus, Plus, Undo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import type { ErrorCode } from '@/server/core/errors'
import { tapParticipationAction, undoLastTapAction } from './performance-actions'

export type BoardRow = { studentId: string; name: string; matricule: string; today: number; net: number }

type Delta = 1 | -1
/** A tap shown on screen but not yet confirmed by the server. */
type PendingTap = { id: number; studentId: string; delta: Delta }

/** Why the last tap or undo failed. */
type BoardError = { kind: 'network' } | { kind: 'notOnRoster' } | { kind: 'code'; code: ErrorCode }

function toBoardError(result: Extract<ActionResult<unknown>, { ok: false }>): BoardError {
  const fields = result.details?.fields
  if (result.code === 'VALIDATION' && Array.isArray(fields) && fields.includes('studentId')) {
    return { kind: 'notOnRoster' }
  }
  return { kind: 'code', code: result.code }
}

/** A net count: "4", "0", "−1" (a true minus sign). */
const plain = (n: number) => (n < 0 ? `−${-n}` : String(n))
/** A change or today's count: "+2", "0", "−1". */
const signed = (n: number) => (n > 0 ? `+${n}` : plain(n))

/**
 * The phone-friendly tap screen. A tap shows at once (optimistic) and is sent in order per student:
 * each student has a queue, so two quick taps become two events, never a race. A refused tap is
 * taken back off the screen and its error shown. One always-mounted status line announces each
 * confirmed tap.
 */
export function ParticipationBoard({ courseId, initial }: { courseId: string; initial: BoardRow[] }) {
  const t = useTranslations('performance.lecturer.board')
  // Server-confirmed counts. After the first render the board keeps them itself.
  const [confirmed, setConfirmed] = useState(initial)
  const [pending, setPending] = useState<PendingTap[]>([])
  const [announcement, setAnnouncement] = useState('')
  const [error, setError] = useState<BoardError | null>(null)
  const [undoing, setUndoing] = useState(false)
  const queues = useRef(new Map<string, Promise<void>>())
  const nextId = useRef(0)
  // Guards against a second undo before the first re-render (the button stays focusable).
  const undoingRef = useRef(false)

  function sendTap(row: BoardRow, tap: PendingTap): Promise<void> {
    return tapParticipationAction(courseId, row.studentId, tap.delta).then(
      (result) => {
        setPending((list) => list.filter((p) => p.id !== tap.id))
        if (result.ok) {
          setConfirmed((rows) =>
            rows.map((r) =>
              r.studentId === row.studentId ? { ...r, today: r.today + tap.delta, net: result.data.net } : r,
            ),
          )
          setAnnouncement(t('announceTap', { name: row.name, delta: signed(tap.delta), net: plain(result.data.net) }))
        } else {
          setError(toBoardError(result))
          setAnnouncement(t('announceFailed', { name: row.name }))
        }
      },
      () => {
        // Network failure or a server crash: roll back and say so.
        setPending((list) => list.filter((p) => p.id !== tap.id))
        setError({ kind: 'network' })
        setAnnouncement(t('announceFailed', { name: row.name }))
      },
    )
  }

  function tap(row: BoardRow, delta: Delta) {
    const entry: PendingTap = { id: nextId.current++, studentId: row.studentId, delta }
    setPending((list) => [...list, entry])
    setError(null)
    const previous = queues.current.get(row.studentId) ?? Promise.resolve()
    const next = previous.then(() => sendTap(row, entry))
    queues.current.set(row.studentId, next)
    // Forget a finished queue so the map doesn't grow with every student tapped.
    void next.then(() => {
      if (queues.current.get(row.studentId) === next) queues.current.delete(row.studentId)
    })
  }

  async function undo() {
    if (undoingRef.current) return
    undoingRef.current = true
    setUndoing(true)
    setError(null)
    // Cleared first so the same message ("Nothing to undo") is announced again.
    setAnnouncement('')
    try {
      // Let every tap already on screen reach the server first, so "last" means the last one.
      await Promise.all(queues.current.values())
      const result = await undoLastTapAction(courseId)
      if (!result.ok) {
        setError(toBoardError(result))
        return
      }
      if (result.data === null) {
        setAnnouncement(t('nothingToUndo'))
        return
      }
      const { studentId, net } = result.data
      const row = confirmed.find((r) => r.studentId === studentId)
      setConfirmed((rows) =>
        rows.map((r) => (r.studentId === studentId ? { ...r, today: r.today - (r.net - net), net } : r)),
      )
      setAnnouncement(row ? t('announceUndo', { name: row.name, net: plain(net) }) : t('undone'))
    } catch {
      setError({ kind: 'network' })
    } finally {
      undoingRef.current = false
      setUndoing(false)
    }
  }

  if (confirmed.length === 0) return <p className="text-muted-foreground">{t('noStudents')}</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-2 z-20 flex flex-col gap-2 rounded-3xl border bg-card/95 p-3 backdrop-blur sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="lg" onClick={undo} aria-disabled={undoing}>
            <Undo2 aria-hidden="true" data-icon="inline-start" />
            {undoing ? t('undoing') : t('undo')}
          </Button>
          <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm font-medium">
            {announcement}
          </p>
        </div>
        {error && (
          <FieldError>
            {error.kind === 'code' ? <ErrorCodeMessage code={error.code} /> : t(error.kind)}
          </FieldError>
        )}
      </div>

      <ul className="flex flex-col divide-y rounded-3xl border">
        {confirmed.map((row) => {
          const mine = pending.filter((p) => p.studentId === row.studentId)
          const offset = mine.reduce((sum, p) => sum + p.delta, 0)
          const today = row.today + offset
          const net = row.net + offset
          return (
            <li key={row.studentId} className="flex items-center gap-3 px-3 py-3 sm:px-5" aria-busy={mine.length > 0}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{row.name}</span>
                <span className="truncate font-mono text-xs tracking-[0.04em] text-muted-foreground">
                  {row.matricule}
                </span>
                <span className="text-sm text-muted-foreground">
                  <span className="whitespace-nowrap">
                    {t('today')} <span className="font-mono text-foreground">{signed(today)}</span>
                  </span>
                  {' · '}
                  <span className="whitespace-nowrap">
                    {t('net')} <span className="font-mono text-foreground">{plain(net)}</span>
                  </span>
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('minusLabel', { name: row.name })}
                  onClick={() => tap(row, -1)}
                  className="h-12 min-w-14 px-4 text-base"
                >
                  <Minus aria-hidden="true" className="size-5" />1
                </Button>
                <Button
                  type="button"
                  aria-label={t('plusLabel', { name: row.name })}
                  onClick={() => tap(row, 1)}
                  className="h-12 min-w-16 px-5 text-base"
                >
                  <Plus aria-hidden="true" className="size-5" />1
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
