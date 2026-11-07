'use client'

import { Play } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState, useTransition } from 'react'
import { ActionError } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { createSessionAction, openWindowAction, setOverrideAction } from './attendance-actions'

const ERROR_REASONS: Record<string, 'alreadyOpened' | 'anotherOpen' | 'noCampusLocation'> = {
  already_opened: 'alreadyOpened',
  another_open: 'anotherOpen',
  no_campus_location: 'noCampusLocation',
}

/** A failed attendance action; the service's known `reason`s get their own message. */
export function AttendanceError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('attendance.lecturer.errors')
  if (!state || state.ok) return null
  const reason = typeof state.details?.reason === 'string' ? ERROR_REASONS[state.details.reason] : undefined
  if (reason) return <FieldError>{t(reason)}</FieldError>
  return <ActionError state={state} />
}

/** "New session": optionally requires students on campus (only when the school has a location). */
export function NewSessionForm({ courseId, hasCampusLocation }: { courseId: string; hasCampusLocation: boolean }) {
  const t = useTranslations('attendance.lecturer')
  const [state, dispatch, pending] = useActionState(
    (_prev: ActionResult<never> | null, data: FormData) => createSessionAction(courseId, data),
    null,
  )
  return (
    <form onSubmit={submitWith(dispatch)} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('newSessionHint')}</p>
      <label
        htmlFor="require-on-campus"
        className="flex items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60"
      >
        <input
          id="require-on-campus"
          name="requireOnCampus"
          type="checkbox"
          disabled={!hasCampusLocation}
          aria-labelledby="require-on-campus-label"
          aria-describedby="require-on-campus-hint"
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span id="require-on-campus-label" className="font-medium">
            {t('requireCampus')}
          </span>
          <span id="require-on-campus-hint" className="text-sm text-muted-foreground">
            {hasCampusLocation ? t('requireCampusHint') : t('noCampusHint')}
          </span>
        </span>
      </label>
      <AttendanceError state={state} />
      <Button type="submit" disabled={pending} className="self-start">
        <Play aria-hidden="true" data-icon="inline-start" />
        {pending ? t('creating') : t('createSession')}
      </Button>
    </form>
  )
}

/** Opens the start or end check-in; disabled (with the reason shown) when it can't be opened. */
export function OpenWindowButton({
  sessionId,
  kind,
  disabledReason,
}: {
  sessionId: string
  kind: 'start' | 'end'
  disabledReason?: string
}) {
  const t = useTranslations('attendance.lecturer')
  const [state, setState] = useState<ActionResult<unknown> | null>(null)
  const [pending, startTransition] = useTransition()
  const reasonId = `open-${kind}-reason`

  function open() {
    startTransition(async () => {
      // On success the action revalidates the page, which then shows the live panel.
      setState(await openWindowAction(sessionId, kind))
    })
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant={kind === 'start' ? 'default' : 'outline'}
        disabled={pending || disabledReason !== undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        onClick={open}
      >
        {pending ? t('opening') : kind === 'start' ? t('openStart') : t('openEnd')}
      </Button>
      {disabledReason && (
        <p id={reasonId} className="text-sm text-muted-foreground">
          {disabledReason}
        </p>
      )}
      <AttendanceError state={state} />
    </div>
  )
}

export type OverrideValue = 'auto' | 'present' | 'partial' | 'absent'

/**
 * The lecturer's verdict for one student: Auto (computed) or a fixed status. Saves on change.
 * The select stays mounted and enabled while saving, so keyboard focus survives: arrowing through
 * a closed select fires `change` per step on Windows, and each step is saved in order (server
 * actions run one at a time per client).
 */
export function OverrideSelect({
  sessionId,
  studentId,
  name,
  value,
}: {
  sessionId: string
  studentId: string
  name: string
  value: OverrideValue
}) {
  const t = useTranslations('attendance.lecturer.override')
  const [selected, setSelected] = useState<OverrideValue>(value)
  const [syncedValue, setSyncedValue] = useState<OverrideValue>(value)
  const [state, setState] = useState<ActionResult<unknown> | null>(null)
  const [pending, startTransition] = useTransition()

  // Follow the server's value when it changes (revalidation, another tab), but not while my own
  // saves are in flight: an earlier save's refresh must not undo the option chosen since.
  if (!pending && value !== syncedValue) {
    setSyncedValue(value)
    setSelected(value)
  }

  function onChange(next: OverrideValue) {
    const previous = selected
    setSelected(next)
    startTransition(async () => {
      const result = await setOverrideAction(sessionId, studentId, next)
      if (!result.ok) setSelected(previous)
      setState(result)
    })
  }

  return (
    <div className="flex w-36 flex-col gap-1">
      <NativeSelect
        aria-label={t('label', { name })}
        value={selected}
        aria-busy={pending}
        onChange={(e) => onChange(e.target.value as OverrideValue)}
        className="h-9"
      >
        {(['auto', 'present', 'partial', 'absent'] as const).map((option) => (
          <option key={option} value={option}>
            {t(option)}
          </option>
        ))}
      </NativeSelect>
      <AttendanceError state={state} />
    </div>
  )
}
