'use client'

import { Check, Info, Lock, Plus, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FieldDescription, FieldError, FieldLegend, FieldSet } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import { cn } from '@/lib/utils'
import type { CatchUpFor, OriginalStatus } from '@/server/tests/authoring'
import { giveCatchUpAction, setCatchUpStudentsAction } from './test-actions'
import { TestError } from './test-error'

export type CatchUpStudent = { studentId: string; name: string; matricule: string | null; status: OriginalStatus }

/** Who missed the original comes first: not joined, left early, didn't hand in, then handed in. */
const STATUS_ORDER: Record<OriginalStatus, number> = {
  not_joined: 0,
  left_early: 1,
  not_handed_in: 2,
  handed_in: 3,
}

/** The roster in the form's order; students keep their roster order within each status. */
export function sortForCatchUp<T extends { status: OriginalStatus }>(students: T[]): T[] {
  // Array.prototype.sort is stable.
  return [...students].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
}

/** CONFLICT and VALIDATION reasons of the catch-up services, keyed to `tests.catchUp.errors`. */
const CONFLICT_REASONS = {
  not_ended: 'notEnded',
  is_catch_up: 'isCatchUp',
  not_catch_up: 'notCatchUp',
  started: 'started',
} as const

function conflictKey(reason: unknown) {
  return typeof reason === 'string' && Object.hasOwn(CONFLICT_REASONS, reason)
    ? CONFLICT_REASONS[reason as keyof typeof CONFLICT_REASONS]
    : undefined
}

/** A failed catch-up action, explained; anything else falls back to the test errors. */
function CatchUpError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('tests.catchUp.errors')
  if (!state || state.ok) return null
  const details = state.details
  if (state.code === 'CONFLICT') {
    const key = conflictKey(details?.reason)
    if (key) return <FieldError>{t(key)}</FieldError>
  }
  if (state.code === 'VALIDATION') {
    if (details?.reason === 'nobody_missed') return <FieldError>{t('nobodyMissed')}</FieldError>
    const fields = details?.fields
    if (Array.isArray(fields) && fields.includes('studentIds')) return <FieldError>{t('studentIds')}</FieldError>
  }
  return <TestError state={state} />
}

/**
 * Who can sit a catch-up: everyone who missed the original, or only the students ticked here.
 * `give` creates the catch-up and opens its edit page; `edit` saves the choice in place. After
 * Start (edit only), the mode is fixed and picked students with an attempt on the catch-up stay
 * ticked: students can be added, and taken off only while they have not opened it.
 */
export function CatchUpForm({
  mode,
  testId,
  courseId,
  students,
  missedCount,
  answersMayBeOut,
  initial,
  withAttempt = [],
  started,
}: {
  mode: 'give' | 'edit'
  /** The original (give) or the catch-up (edit). */
  testId: string
  courseId: string
  students: CatchUpStudent[]
  missedCount: number
  answersMayBeOut: boolean
  initial?: { for: CatchUpFor; studentIds: string[] }
  /** Edit: the picked students with an attempt on the catch-up; after Start they stay ticked. */
  withAttempt?: string[]
  started: boolean
}) {
  const t = useTranslations('tests.catchUp')
  const router = useRouter()
  // What is stored now (edit): after Start it decides the fixed mode and the ticks that stay.
  const [stored, setStored] = useState(initial ?? null)
  const [choice, setChoice] = useState<CatchUpFor>(initial?.for ?? (missedCount > 0 ? 'missed' : 'picked'))
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(initial?.studentIds ?? []))
  const [state, setState] = useState<ActionResult<unknown> | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startSaving] = useTransition()

  const fixed = started && stored !== null
  const opened = new Set(withAttempt)
  const locked = new Set(fixed && stored.for === 'picked' ? stored.studentIds.filter((id) => opened.has(id)) : [])
  const everyoneSat = missedCount === 0
  const missedDisabled = fixed ? stored.for !== 'missed' : everyoneSat && stored?.for !== 'missed'
  const pickedDisabled = fixed && stored.for !== 'picked'
  const canSave = !(fixed && stored.for === 'missed')
  const ordered = sortForCatchUp(students)
  const onRoster = new Set(students.map((s) => s.studentId))
  const pickedOnRoster = [...picked].filter((id) => onRoster.has(id)).length

  function choose(next: CatchUpFor) {
    setChoice(next)
    setSaved(false)
  }

  function toggle(studentId: string, on: boolean) {
    if (locked.has(studentId)) return
    setPicked((current) => {
      const next = new Set(current)
      if (on) next.add(studentId)
      else next.delete(studentId)
      return next
    })
    setSaved(false)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Picked students who have since left the course are not listed, so they are not sent either.
    const input = { for: choice, studentIds: choice === 'picked' ? [...picked].filter((id) => onRoster.has(id)) : [] }
    startSaving(async () => {
      if (mode === 'give') {
        const result = await giveCatchUpAction(testId, input)
        setState(result)
        if (result.ok) {
          router.push(`/courses/${encodeURIComponent(courseId)}/tests/${encodeURIComponent(result.data.id)}/edit`)
        }
        return
      }
      const result = await setCatchUpStudentsAction(testId, input)
      setState(result)
      if (!result.ok) return
      setStored(input)
      setSaved(true)
      router.refresh()
    })
  }

  const invalidList = state && !state.ok && Array.isArray(state.details?.fields) && state.details.fields.includes('studentIds')

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <FieldSet>
        <FieldLegend>{t('whoCanSit')}</FieldLegend>
        {fixed && (
          <FieldDescription className="inline-flex items-start gap-2">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {stored.for === 'missed' ? t('startedMissed') : t('startedPicked')}
          </FieldDescription>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            value="missed"
            checked={choice === 'missed'}
            disabled={missedDisabled}
            label={t('missed', { count: missedCount })}
            hint={everyoneSat ? t('everyoneSat') : undefined}
            onChoose={choose}
          />
          <ChoiceCard
            value="picked"
            checked={choice === 'picked'}
            disabled={pickedDisabled}
            label={t('picked')}
            onChoose={choose}
          />
        </div>
      </FieldSet>

      {choice === 'picked' && (
        <FieldSet data-invalid={invalidList || undefined}>
          <FieldLegend variant="label" className="sr-only">
            {t('picked')}
          </FieldLegend>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t('pickedCount', { count: pickedOnRoster })}
          </p>
          {ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noStudents')}</p>
          ) : (
            <ul className={cn('flex flex-col divide-y rounded-2xl border', invalidList && 'border-destructive')}>
              {ordered.map((s) => {
                const id = `catch-up-student-${s.studentId}`
                const isLocked = locked.has(s.studentId)
                return (
                  <li key={s.studentId}>
                    <label
                      htmlFor={id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3 has-disabled:cursor-default"
                    >
                      <input
                        id={id}
                        type="checkbox"
                        value={s.studentId}
                        checked={picked.has(s.studentId)}
                        disabled={isLocked}
                        className="size-5 shrink-0 accent-primary"
                        onChange={(e) => toggle(s.studentId, e.target.checked)}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium wrap-anywhere">{s.name}</span>
                        {s.matricule && (
                          <span className="font-mono text-xs tracking-[0.05em] text-muted-foreground uppercase">
                            {s.matricule}
                          </span>
                        )}
                      </span>
                      <Badge variant={s.status === 'handed_in' ? 'outline' : 'secondary'}>{t(`status.${s.status}`)}</Badge>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </FieldSet>
      )}

      {mode === 'give' && answersMayBeOut && (
        <p className="flex items-start gap-2 rounded-2xl bg-muted/60 p-4 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {t('answersNote')}
        </p>
      )}

      <CatchUpError state={state} />
      {canSave && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" pending={pending}>
            {mode === 'give' ? (
              <Plus aria-hidden="true" data-icon="inline-start" />
            ) : (
              <Save aria-hidden="true" data-icon="inline-start" />
            )}
            {mode === 'give' ? (pending ? t('giving') : t('give')) : pending ? t('saving') : t('save')}
          </Button>
          {saved && !pending && (
            <p role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check aria-hidden="true" className="size-4 shrink-0" />
              {t('saved')}
            </p>
          )}
        </div>
      )}
    </form>
  )
}

/** One "who can sit it" option: a radio with its label, the whole card the touch target. */
function ChoiceCard({
  value,
  checked,
  disabled,
  label,
  hint,
  onChoose,
}: {
  value: CatchUpFor
  checked: boolean
  disabled: boolean
  label: string
  hint?: string
  onChoose: (value: CatchUpFor) => void
}) {
  const id = `catch-up-for-${value}`
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors has-checked:border-primary/40 has-checked:bg-primary/5 has-disabled:cursor-default has-disabled:opacity-60"
    >
      <input
        id={id}
        type="radio"
        name="catch-up-for"
        value={value}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-5 shrink-0 accent-primary"
        onChange={() => onChoose(value)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && (
          <span id={`${id}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </label>
  )
}
