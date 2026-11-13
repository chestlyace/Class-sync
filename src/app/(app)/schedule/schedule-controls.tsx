'use client'

import { CalendarX2, Check, ClipboardCheck, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState, useTransition } from 'react'
import { SectionHeading } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { answerSittingAction, cancelClassAction, startClassAttendanceAction, undoCancelAction } from './actions'
import { MakeUpDialog, MakeUpFields, type MakeUpDefaults } from './make-up-form'
import { ScheduleError } from './schedule-error'

/**
 * One tap on a sitting: opens check-in (or finds the session already opened) and goes to its live code.
 * Always posts the sitting's key, never a single class's.
 */
export function OpenCheckInButton({
  sittingKey,
  size = 'default',
}: {
  sittingKey: string
  size?: 'default' | 'lg'
}) {
  const t = useTranslations('schedule.row')
  const [state, setState] = useState<ActionResult<unknown> | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        size={size}
        disabled={pending}
        onClick={() => startTransition(async () => setState(await startClassAttendanceAction(sittingKey)))}
      >
        <ClipboardCheck aria-hidden="true" data-icon="inline-start" />
        {pending ? t('opening') : t('openCheckIn')}
      </Button>
      <ScheduleError state={state} />
    </div>
  )
}

function UndoCancelButton({ occurrenceKey, label }: { occurrenceKey: string; label: string }) {
  const t = useTranslations('schedule.row')
  const [state, setState] = useState<ActionResult<unknown> | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`${t('undoCancel')} · ${label}`}
        onClick={() => startTransition(async () => setState(await undoCancelAction(occurrenceKey)))}
      >
        <RotateCcw aria-hidden="true" data-icon="inline-start" />
        {pending ? t('undoing') : t('undoCancel')}
      </Button>
      <ScheduleError state={state} />
    </div>
  )
}

/** The cancel form; mounted on each opening so an old error or a ticked box never lingers. */
function CancelForm({
  occurrenceKey,
  makeUpDefaults,
  onDone,
}: {
  occurrenceKey: string
  makeUpDefaults: MakeUpDefaults
  onDone: () => void
}) {
  const t = useTranslations('schedule.cancel')
  const [withMakeUp, setWithMakeUp] = useState(false)
  const [state, dispatch, pending] = useActionState(async (_prev: ActionResult<null> | null, data: FormData) => {
    const result = await cancelClassAction(occurrenceKey, data)
    if (result.ok) onDone()
    return result
  }, null)
  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
      <label htmlFor="cancel-make-up" className="flex items-start gap-3">
        <input
          id="cancel-make-up"
          name="makeUp"
          type="checkbox"
          checked={withMakeUp}
          onChange={(e) => setWithMakeUp(e.target.checked)}
          aria-describedby="cancel-make-up-hint"
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t('addMakeUp')}</span>
          <span id="cancel-make-up-hint" className="text-sm text-muted-foreground">
            {t('addMakeUpHint')}
          </span>
        </span>
      </label>
      {withMakeUp && <MakeUpFields idPrefix="cancel" defaults={makeUpDefaults} state={state} />}
      <ScheduleError state={state} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" size="lg" variant="outline">
            {t('keep')}
          </Button>
        </DialogClose>
        <Button type="submit" size="lg" variant="destructive" disabled={pending}>
          {pending ? t('cancelling') : t('confirm')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** "Can't make it": cancels one class, optionally with its make-up in the same step. */
function CantMakeItButton({
  occurrenceKey,
  courseTitle,
  when,
  makeUpDefaults,
}: {
  occurrenceKey: string
  courseTitle: string
  when: string
  makeUpDefaults: MakeUpDefaults
}) {
  const t = useTranslations('schedule')
  const tCommon = useTranslations('common')
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`${t('row.cantMakeIt')} · ${courseTitle}, ${when}`}
        onClick={() => setOpen(true)}
      >
        <CalendarX2 aria-hidden="true" data-icon="inline-start" />
        {t('row.cantMakeIt')}
      </Button>
      <DialogContent closeLabel={tCommon('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cancel.title')}</DialogTitle>
          <DialogDescription>{t('cancel.body', { course: courseTitle, when })}</DialogDescription>
        </DialogHeader>
        <CancelForm occurrenceKey={occurrenceKey} makeUpDefaults={makeUpDefaults} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

/** The actions of one class on the Schedule page. Cancel and undo act on the class; check-in on its sitting. */
export function RowActions({
  occurrenceKey,
  sittingKey,
  canOpenCheckIn,
  canCancel,
  canUndo,
  courseTitle,
  when,
  makeUpDefaults,
}: {
  occurrenceKey: string
  sittingKey: string | null
  canOpenCheckIn: boolean
  canCancel: boolean
  canUndo: boolean
  courseTitle: string
  /** "Mon 10 Nov · 08:00–10:00" */
  when: string
  makeUpDefaults: MakeUpDefaults
}) {
  const showCheckIn = canOpenCheckIn && sittingKey !== null
  if (!showCheckIn && !canCancel && !canUndo) return null
  return (
    <div className="flex flex-wrap items-start gap-2">
      {showCheckIn && <OpenCheckInButton sittingKey={sittingKey} />}
      {canCancel && (
        <CantMakeItButton
          occurrenceKey={occurrenceKey}
          courseTitle={courseTitle}
          when={when}
          makeUpDefaults={makeUpDefaults}
        />
      )}
      {canUndo && <UndoCancelButton occurrenceKey={occurrenceKey} label={`${courseTitle}, ${when}`} />}
    </div>
  )
}

export type NeedsAnswerItem = {
  sittingKey: string
  courseId: string
  /** "Mon 3 Nov · 08:00–10:00 · Networks · no attendance" */
  label: string
  /** "Replaces Networks of Mon 3 Nov." */
  replacesLabel: string
  makeUpDefaults: MakeUpDefaults
}

function NeedsAnswerRow({ item, onMissed }: { item: NeedsAnswerItem; onMissed: (item: NeedsAnswerItem) => void }) {
  const t = useTranslations('schedule.needsAnswer')
  const [state, setState] = useState<ActionResult<unknown> | null>(null)
  const [pending, startTransition] = useTransition()

  function answer(value: 'taught' | 'missed') {
    startTransition(async () => {
      const result = await answerSittingAction(item.sittingKey, value)
      setState(result)
      if (result.ok && value === 'missed') onMissed(item)
    })
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <span className="min-w-0">{item.label}</span>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => answer('taught')}>
            <Check aria-hidden="true" data-icon="inline-start" />
            {t('taught')}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => answer('missed')}>
            <CalendarX2 aria-hidden="true" data-icon="inline-start" />
            {t('missed')}
          </Button>
        </div>
        {pending && (
          <span role="status" className="text-sm text-muted-foreground">
            {t('saving')}
          </span>
        )}
        <ScheduleError state={state} />
      </div>
    </li>
  )
}

/**
 * "Needs your answer". It stays mounted when the list empties, so the make-up dialog opened by
 * "Missed · reschedule" survives the refresh that removes the answered row.
 */
export function NeedsAnswerList({ items }: { items: NeedsAnswerItem[] }) {
  const t = useTranslations('schedule.needsAnswer')
  const [reschedule, setReschedule] = useState<NeedsAnswerItem | null>(null)
  return (
    <>
      {items.length > 0 && (
        <section aria-labelledby="needs-answer" className="flex flex-col gap-4">
          <SectionHeading id="needs-answer">{t('title')}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
          <ul className="flex flex-col divide-y rounded-3xl border">
            {items.map((item) => (
              <NeedsAnswerRow key={item.sittingKey} item={item} onMissed={setReschedule} />
            ))}
          </ul>
        </section>
      )}
      {reschedule && (
        <MakeUpDialog
          open
          onOpenChange={(open) => {
            if (!open) setReschedule(null)
          }}
          courses={[]}
          courseId={reschedule.courseId}
          replaces={reschedule.sittingKey}
          replacesLabel={reschedule.replacesLabel}
          defaults={reschedule.makeUpDefaults}
        />
      )}
    </>
  )
}
