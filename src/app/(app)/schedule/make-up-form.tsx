'use client'

import { CalendarPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { addMakeUpAction } from './actions'
import { ScheduleError } from './schedule-error'

export type CourseOption = { id: string; title: string; className: string; schoolName: string }

/** Prefilled values of the make-up fields: a date ("YYYY-MM-DD") and times ("HH:MM"). */
export type MakeUpDefaults = { date: string; start: string; end: string; room: string }

/** Date, times, room and the on-campus rule of a one-off class. Field names match the service's. */
export function MakeUpFields({
  idPrefix,
  defaults,
  state,
}: {
  idPrefix: string
  defaults: MakeUpDefaults
  state: ActionResult<unknown> | null
}) {
  const t = useTranslations('schedule.makeUp')
  const tCommon = useTranslations('common')
  const invalid = (field: string) => isInvalidField(state, field) || undefined
  return (
    <FieldGroup className="gap-4">
      <Field data-invalid={invalid('date')}>
        <FieldLabel htmlFor={`${idPrefix}-date`}>{t('date')}</FieldLabel>
        <Input
          id={`${idPrefix}-date`}
          name="date"
          type="date"
          required
          defaultValue={defaults.date}
          aria-invalid={invalid('date')}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field data-invalid={invalid('startMinute')}>
          <FieldLabel htmlFor={`${idPrefix}-start`}>{t('start')}</FieldLabel>
          <Input
            id={`${idPrefix}-start`}
            name="startMinute"
            type="time"
            required
            defaultValue={defaults.start}
            aria-invalid={invalid('startMinute')}
          />
        </Field>
        <Field data-invalid={invalid('endMinute')}>
          <FieldLabel htmlFor={`${idPrefix}-end`}>{t('end')}</FieldLabel>
          <Input
            id={`${idPrefix}-end`}
            name="endMinute"
            type="time"
            required
            defaultValue={defaults.end}
            aria-invalid={invalid('endMinute')}
          />
        </Field>
      </div>
      <Field data-invalid={invalid('room')}>
        <FieldLabel htmlFor={`${idPrefix}-room`}>
          {t('room')} <span className="font-normal text-muted-foreground">({tCommon('optional')})</span>
        </FieldLabel>
        <Input
          id={`${idPrefix}-room`}
          name="room"
          maxLength={60}
          defaultValue={defaults.room}
          placeholder={t('roomPlaceholder')}
          aria-invalid={invalid('room')}
        />
      </Field>
      <label htmlFor={`${idPrefix}-campus`} className="flex items-start gap-3">
        <input
          id={`${idPrefix}-campus`}
          name="requireOnCampus"
          type="checkbox"
          aria-describedby={`${idPrefix}-campus-hint`}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t('requireCampus')}</span>
          <span id={`${idPrefix}-campus-hint`} className="text-sm text-muted-foreground">
            {t('requireCampusHint')}
          </span>
        </span>
      </label>
    </FieldGroup>
  )
}

/** The form inside the dialog: mounted on each opening, so an old error never shows again. */
function MakeUpForm({
  courses,
  courseId,
  replaces,
  defaults,
  onDone,
}: {
  courses: CourseOption[]
  courseId?: string
  replaces?: string
  defaults: MakeUpDefaults
  onDone: () => void
}) {
  const t = useTranslations('schedule.makeUp')
  const tCommon = useTranslations('common')
  const [state, dispatch, pending] = useActionState(async (_prev: ActionResult<null> | null, data: FormData) => {
    const course = data.get('courseId')
    const result = await addMakeUpAction(typeof course === 'string' ? course : '', data)
    if (result.ok) onDone()
    return result
  }, null)

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
      {replaces && <input type="hidden" name="replaces" value={replaces} />}
      {courseId ? (
        <input type="hidden" name="courseId" value={courseId} />
      ) : (
        <Field>
          <FieldLabel htmlFor="make-up-course">{t('course')}</FieldLabel>
          <NativeSelect id="make-up-course" name="courseId" required defaultValue={courses[0]?.id}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.className} · {c.schoolName}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <MakeUpFields idPrefix="make-up" defaults={defaults} state={state} />
      <ScheduleError state={state} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" size="lg" variant="outline">
            {tCommon('cancel')}
          </Button>
        </DialogClose>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** "Make-up class": for any course, or for one course when it replaces a missed class (`replaces`). */
export function MakeUpDialog({
  open,
  onOpenChange,
  courses,
  courseId,
  replaces,
  replacesLabel,
  defaults,
  trigger,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  courses: CourseOption[]
  courseId?: string
  replaces?: string
  /** "Replaces Networks of Mon 3 Nov." */
  replacesLabel?: string
  defaults: MakeUpDefaults
  /** The button that opens the dialog; focus returns to it on close. */
  trigger?: React.ReactNode
}) {
  const t = useTranslations('schedule.makeUp')
  const tCommon = useTranslations('common')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent closeLabel={tCommon('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{replacesLabel ?? t('description')}</DialogDescription>
        </DialogHeader>
        {courseId || courses.length > 0 ? (
          <MakeUpForm
            courses={courses}
            courseId={courseId}
            replaces={replaces}
            defaults={defaults}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <p className="text-muted-foreground">{t('noCourses')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The Schedule page's "Make-up class" button. */
export function MakeUpButton({ courses, today }: { courses: CourseOption[]; today: string }) {
  const t = useTranslations('schedule.makeUp')
  const [open, setOpen] = useState(false)
  return (
    <MakeUpDialog
      open={open}
      onOpenChange={setOpen}
      courses={courses}
      defaults={{ date: today, start: '', end: '', room: '' }}
      trigger={
        <Button type="button">
          <CalendarPlus aria-hidden="true" data-icon="inline-start" />
          {t('button')}
        </Button>
      }
    />
  )
}
