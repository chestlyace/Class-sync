'use client'

import { ChartColumn, DoorOpen, Pencil, Play, ScrollText, Square, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { ConfirmAction } from '@/components/confirm-action'
import { CopyButton } from '@/components/copy-button'
import { Eyebrow } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/components/ui/field'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ActionResult } from '@/lib/action-result'
import { formatDecimal } from '@/lib/number-format'
import { TEST_LIVE_POLL_MS } from '@/server/tests/rules'
import type { LiveStatus } from '@/server/tests/run'
import {
  deleteTestAction,
  endTestAction,
  getAttemptLogAction,
  getLiveTestAction,
  letBackInAction,
  startTestAction,
  type LiveTestView,
  type LogEntryView,
} from './test-actions'
import { TestError } from './test-error'

type Snapshot = { view: LiveTestView; receivedAt: number }
type LiveRowView = LiveTestView['rows'][number]
type PollProblem = { kind: 'network' } | { kind: 'error'; result: Extract<ActionResult<unknown>, { ok: false }> }

const renderError = (state: ActionResult<unknown> | null) => <TestError state={state} />

const STATUS_VARIANT: Record<LiveStatus, 'outline' | 'secondary' | 'destructive'> = {
  not_joined: 'outline',
  waiting: 'outline',
  working: 'secondary',
  away: 'destructive',
  ended: 'destructive',
  handed_in: 'secondary',
}

/** "1:05:09" or "24:59" from milliseconds (never negative). */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/**
 * The lecturer's live view of a test. Polls `getLiveTestAction` every TEST_LIVE_POLL_MS until the
 * test has ended; the countdown runs on the local clock, offset to the server's time at each
 * answer (as the student's clock does). A change of phase (started elsewhere, deadline passed)
 * refreshes the page, which re-renders this view for the new phase.
 */
export function TestLive({
  initial,
  courseId,
  link,
  timeZone,
}: {
  initial: LiveTestView
  courseId: string
  link: string
  timeZone: string
}) {
  const t = useTranslations('tests.lecturer.live')
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ view: initial, receivedAt: Date.now() }))
  const [now, setNow] = useState(() => Date.now())
  const [problem, setProblem] = useState<PollProblem | null>(null)
  const { view } = snapshot
  const testId = view.testId
  const phase = view.phase
  const initialPhase = initial.phase

  useEffect(() => {
    if (initialPhase === 'ended') return
    let cancelled = false
    let request = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    async function poll() {
      const mine = ++request
      try {
        const result = await getLiveTestAction(testId)
        if (cancelled || mine !== request) return
        if (!result.ok) {
          setProblem({ kind: 'error', result })
          return // e.g. the test was deleted: polling again won't help
        }
        setSnapshot({ view: result.data, receivedAt: Date.now() })
        setProblem(null)
        if (result.data.phase !== initialPhase) {
          router.refresh() // the page shows the new phase (and stops this poll)
          return
        }
      } catch {
        if (cancelled || mine !== request) return
        setProblem({ kind: 'network' })
      }
      timer = setTimeout(poll, TEST_LIVE_POLL_MS)
    }

    timer = setTimeout(poll, TEST_LIVE_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [testId, initialPhase, router])

  // A one-second tick for the countdown.
  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [phase])

  async function refreshNow() {
    try {
      const result = await getLiveTestAction(testId)
      if (result.ok) setSnapshot({ view: result.data, receivedAt: Date.now() })
    } catch {
      // The next poll will catch up.
    }
  }

  const serverNow = new Date(view.serverNow).getTime() + (now - snapshot.receivedAt)
  const remaining = view.endsAt ? new Date(view.endsAt).getTime() - serverNow : null
  const testsHref = `/courses/${encodeURIComponent(courseId)}/tests`
  const testHref = `${testsHref}/${encodeURIComponent(testId)}`

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="test-link" className="flex flex-col gap-5 rounded-3xl border bg-card p-5 sm:p-7">
        <div className="flex flex-col gap-2">
          <Eyebrow>
            <span id="test-link">{t('linkLabel')}</span>
          </Eyebrow>
          <div className="flex flex-wrap items-center gap-3">
            <code className="min-w-0 font-mono text-sm break-all sm:text-lg">{link}</code>
            <CopyButton value={link} label={t('copyLink')} />
          </div>
          {phase === 'not_started' && <p className="text-sm text-muted-foreground">{t('notStartedHint')}</p>}
        </div>

        {phase === 'running' && remaining !== null && (
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('timeLeft')}</Eyebrow>
            <p
              className="font-display text-[min(20vw,6rem)] leading-none tracking-[0.04em] tabular-nums"
              role="timer"
              aria-live="off"
            >
              {formatCountdown(remaining)}
            </p>
          </div>
        )}

        {phase === 'not_started' && (
          <div className="flex flex-col gap-4">
            <p aria-live="polite" className="text-lg font-semibold">
              {t('waiting', { count: view.counts.joined })}
            </p>
            <div className="flex flex-wrap gap-2.5">
              <ConfirmAction
                action={() => startTestAction(testId)}
                fields={{}}
                primary
                triggerLabel={t('start')}
                triggerIcon={<Play aria-hidden="true" data-icon="inline-start" />}
                title={t('startTitle')}
                body={t('startBody')}
                confirmLabel={t('startConfirm')}
                renderError={renderError}
              />
              <Link href={`${testHref}/edit`} className={buttonVariants({ variant: 'outline' })}>
                <Pencil aria-hidden="true" data-icon="inline-start" />
                {t('edit')}
              </Link>
              <ConfirmAction
                action={() => deleteTestAction(testId)}
                fields={{}}
                destructive
                triggerLabel={t('delete')}
                triggerIcon={<Trash2 aria-hidden="true" data-icon="inline-start" />}
                title={t('deleteTitle')}
                body={t('deleteBody')}
                confirmLabel={t('deleteConfirm')}
                renderError={renderError}
              />
            </div>
          </div>
        )}

        {phase === 'ended' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground">{t('endedNote')}</p>
            <Link href={`${testHref}/results`} className={buttonVariants({ variant: 'default' })}>
              <ChartColumn aria-hidden="true" data-icon="inline-start" />
              {t('results')}
            </Link>
          </div>
        )}

        {problem && (
          <FieldError>
            {problem.kind === 'network' ? t('reconnecting') : <ErrorCodeMessage code={problem.result.code} />}
          </FieldError>
        )}
      </section>

      {phase !== 'not_started' && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['joined', view.counts.joined],
                ['working', view.counts.working],
                ['handedIn', view.counts.handedIn],
                ['endedLeaving', view.counts.endedLeaving],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1 rounded-3xl border bg-card p-4 sm:p-5">
                <dt className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
                  {t(`counts.${key}`)}
                </dt>
                <dd className="flex items-baseline gap-1.5">
                  <span className="font-display text-5xl leading-none tracking-[0.02em]">{value}</span>
                  {key === 'joined' && (
                    <span className="font-mono text-xs text-muted-foreground">{t('ofRoster', { count: view.counts.roster })}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <StudentTable view={view} timeZone={timeZone} onChanged={refreshNow} />

          {phase === 'running' && (
            <div>
              <ConfirmAction
                action={() => endTestAction(testId)}
                fields={{}}
                destructive
                triggerLabel={t('end')}
                triggerIcon={<Square aria-hidden="true" data-icon="inline-start" />}
                title={t('endTitle')}
                body={t('endBody')}
                confirmLabel={t('endConfirm')}
                renderError={renderError}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StudentTable({
  view,
  timeZone,
  onChanged,
}: {
  view: LiveTestView
  timeZone: string
  onChanged: () => Promise<void>
}) {
  const t = useTranslations('tests.lecturer.live')
  const [log, setLog] = useState<{ row: LiveRowView; result: ActionResult<LogEntryView[]> | null } | null>(null)

  function openLog(row: LiveRowView) {
    const attemptId = row.attemptId
    if (!attemptId) return
    setLog({ row, result: null })
    const settle = (result: ActionResult<LogEntryView[]>) =>
      setLog((current) => (current?.row.attemptId === attemptId ? { row, result } : current))
    getAttemptLogAction(attemptId)
      .then(settle)
      .catch(() => settle({ ok: false, code: 'NOT_FOUND' }))
  }

  return (
    <section aria-labelledby="test-students" className="flex flex-col gap-3">
      <h2 id="test-students" className="font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">
        {t('students')}
      </h2>
      {view.rows.length === 0 ? (
        <p className="text-muted-foreground">{t('noStudents')}</p>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto rounded-3xl border bg-card">
          <Table>
            <TableCaption className="sr-only">{t('tableCaption')}</TableCaption>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead scope="col" className="px-4">
                  {t('columns.student')}
                </TableHead>
                <TableHead scope="col">{t('columns.matricule')}</TableHead>
                <TableHead scope="col">{t('columns.status')}</TableHead>
                <TableHead scope="col" className="text-right">
                  {t('columns.answers')}
                </TableHead>
                <TableHead scope="col" className="text-right">
                  {t('columns.exits')}
                </TableHead>
                <TableHead scope="col">
                  <span className="sr-only">{t('columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.map((row) => (
                <TableRow key={row.studentId}>
                  <TableHead scope="row" className="px-4 font-medium">
                    {row.attemptId ? (
                      <button
                        type="button"
                        onClick={() => openLog(row)}
                        aria-label={t('openLog', { name: row.name })}
                        className="inline-flex min-h-11 items-center gap-1.5 text-left underline-offset-4 hover:underline"
                      >
                        <ScrollText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        {row.name}
                      </button>
                    ) : (
                      row.name
                    )}
                  </TableHead>
                  <TableCell className="font-mono tracking-[0.04em]">{row.matricule}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>{t(`status.${row.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono whitespace-nowrap">
                    {t('answers', { answered: row.answered, total: view.questionCount })}
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.exits}</TableCell>
                  <TableCell className="text-right">
                    {row.status === 'ended' && view.phase === 'running' && row.attemptId && (
                      <LetBackInButton attemptId={row.attemptId} name={row.name} onDone={onChanged} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <AttemptLogDialog
        name={log?.row.name ?? null}
        result={log?.result ?? null}
        timeZone={timeZone}
        onClose={() => setLog(null)}
      />
    </section>
  )
}

function LetBackInButton({ attemptId, name, onDone }: { attemptId: string; name: string; onDone: () => Promise<void> }) {
  const t = useTranslations('tests.lecturer.live')
  const [state, setState] = useState<ActionResult<null> | null>(null)
  const [pending, startTransition] = useTransition()

  function letIn() {
    startTransition(async () => {
      const result = await letBackInAction(attemptId)
      setState(result)
      if (result.ok) await onDone()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={letIn} aria-label={t('letBackInLabel', { name })}>
        <DoorOpen aria-hidden="true" data-icon="inline-start" />
        {pending ? t('lettingIn') : t('letBackIn')}
      </Button>
      <TestError state={state} />
    </div>
  )
}

/** One student's log: exits with their time away, ending, reopening, hand-in. */
function AttemptLogDialog({
  name,
  result,
  timeZone,
  onClose,
}: {
  /** The student whose log is open, or null when closed. */
  name: string | null
  /** Null while loading. */
  result: ActionResult<LogEntryView[]> | null
  timeZone: string
  onClose: () => void
}) {
  const t = useTranslations('tests.lecturer.live.log')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const time = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  })

  function describe(entry: LogEntryView): string {
    if (entry.kind !== 'exit') return t(entry.kind)
    const n = entry.exitNumber ?? 0
    if (entry.awayMs === null) return t('exitOpen', { n })
    return t('exit', { n, seconds: formatDecimal(Math.round(entry.awayMs / 100) / 10, locale) })
  }

  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={tCommon('close')}>
        <DialogHeader>
          <DialogTitle>{t('title', { name: name ?? '' })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {result === null ? (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        ) : !result.ok ? (
          <FieldError>
            <ErrorCodeMessage code={result.code} />
          </FieldError>
        ) : result.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ol className="flex max-h-[50vh] flex-col divide-y overflow-y-auto rounded-2xl border">
            {result.data.map((entry, i) => (
              <li key={i} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                <time dateTime={entry.at} className="shrink-0 font-mono text-xs text-muted-foreground">
                  {time.format(new Date(entry.at))}
                </time>
                <span>{describe(entry)}</span>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}
