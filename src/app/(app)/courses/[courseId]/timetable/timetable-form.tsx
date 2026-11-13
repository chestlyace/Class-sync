'use client'

import { Pencil, Plus, Save, Trash2, TriangleAlert, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useRef, useState } from 'react'
import { isInvalidField } from '@/components/action-error'
import { ConfirmAction } from '@/components/confirm-action'
import { Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import type { SlotOverlap } from '@/server/schedule/timetable'
import { createSlotAction, removeSlotAction, updateSlotAction, type SlotSaved } from '../../../schedule/actions'
import { ScheduleError } from '../../../schedule/schedule-error'
import { minutesToTime } from '../../../schedule/schedule-format'

/** A slot's form values: times as "HH:MM", dates as "YYYY-MM-DD". */
export type SlotFormValues = {
  weekday: number
  start: string
  end: string
  room: string
  requireOnCampus: boolean
  startsOn: string
  endsOn: string
}

/** A saved slot with its labels already in the reader's language. */
export type SlotListItem = SlotFormValues & { id: string; dayLabel: string; termLabel: string }

type Notice = { overlaps: SlotOverlap[] }

function SlotForm({
  target,
  initial,
  hasCampusLocation,
  weekdays,
  onSaved,
  onCancel,
}: {
  target: { kind: 'create'; courseId: string } | { kind: 'edit'; slotId: string }
  initial: SlotFormValues
  hasCampusLocation: boolean
  /** Monday first: index 0 is weekday 1. */
  weekdays: string[]
  onSaved: (saved: SlotSaved) => void
  onCancel?: () => void
}) {
  const t = useTranslations('schedule.timetable')
  const tCommon = useTranslations('common')
  const formRef = useRef<HTMLFormElement>(null)
  const [state, dispatch, pending] = useActionState(async (_prev: ActionResult<SlotSaved> | null, data: FormData) => {
    const result =
      target.kind === 'create'
        ? await createSlotAction(target.courseId, data)
        : await updateSlotAction(target.slotId, data)
    if (result.ok) {
      if (target.kind === 'create') formRef.current?.reset()
      onSaved(result.data)
    }
    return result
  }, null)
  const invalid = (field: string) => isInvalidField(state, field) || undefined
  const id = (name: string) => `${target.kind === 'create' ? 'new-slot' : `slot-${target.slotId}`}-${name}`

  return (
    <form ref={formRef} onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <FieldGroup className="gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field data-invalid={invalid('weekday')}>
            <FieldLabel htmlFor={id('weekday')}>{t('weekday')}</FieldLabel>
            <NativeSelect id={id('weekday')} name="weekday" defaultValue={String(initial.weekday)} required>
              {weekdays.map((label, index) => (
                <option key={label} value={String(index + 1)}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={invalid('startMinute')}>
            <FieldLabel htmlFor={id('start')}>{t('start')}</FieldLabel>
            <Input
              id={id('start')}
              name="startMinute"
              type="time"
              required
              defaultValue={initial.start}
              aria-invalid={invalid('startMinute')}
              aria-describedby={id('time-hint')}
            />
          </Field>
          <Field data-invalid={invalid('endMinute')}>
            <FieldLabel htmlFor={id('end')}>{t('end')}</FieldLabel>
            <Input
              id={id('end')}
              name="endMinute"
              type="time"
              required
              defaultValue={initial.end}
              aria-invalid={invalid('endMinute')}
              aria-describedby={id('time-hint')}
            />
          </Field>
        </div>
        <FieldDescription id={id('time-hint')} className="-mt-2">
          {t('hint')}
        </FieldDescription>

        <Field data-invalid={invalid('room')} className="sm:max-w-xs">
          <FieldLabel htmlFor={id('room')}>
            {t('room')} <span className="font-normal text-muted-foreground">({tCommon('optional')})</span>
          </FieldLabel>
          <Input
            id={id('room')}
            name="room"
            maxLength={60}
            defaultValue={initial.room}
            placeholder={t('roomPlaceholder')}
            aria-invalid={invalid('room')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={invalid('startsOn')}>
            <FieldLabel htmlFor={id('starts-on')}>{t('startsOn')}</FieldLabel>
            <Input
              id={id('starts-on')}
              name="startsOn"
              type="date"
              required
              defaultValue={initial.startsOn}
              aria-invalid={invalid('startsOn')}
              aria-describedby={id('term-hint')}
            />
          </Field>
          <Field data-invalid={invalid('endsOn')}>
            <FieldLabel htmlFor={id('ends-on')}>{t('endsOn')}</FieldLabel>
            <Input
              id={id('ends-on')}
              name="endsOn"
              type="date"
              required
              defaultValue={initial.endsOn}
              aria-invalid={invalid('endsOn')}
              aria-describedby={id('term-hint')}
            />
          </Field>
        </div>
        <FieldDescription id={id('term-hint')} className="-mt-2">
          {t('termHint')}
        </FieldDescription>

        <label
          htmlFor={id('campus')}
          className="flex items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60"
        >
          <input
            id={id('campus')}
            name="requireOnCampus"
            type="checkbox"
            defaultChecked={initial.requireOnCampus}
            disabled={!hasCampusLocation && !initial.requireOnCampus}
            aria-describedby={id('campus-hint')}
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t('requireCampus')}</span>
            <span id={id('campus-hint')} className="text-sm text-muted-foreground">
              {hasCampusLocation ? t('requireCampusHint') : t('noCampusHint')}
            </span>
          </span>
        </label>
      </FieldGroup>

      <ScheduleError state={state} />
      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" disabled={pending}>
          {target.kind === 'create' ? (
            <Plus aria-hidden="true" data-icon="inline-start" />
          ) : (
            <Save aria-hidden="true" data-icon="inline-start" />
          )}
          {target.kind === 'create' ? (pending ? t('adding') : t('add')) : pending ? t('saving') : t('save')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}

/** After a save: "Saved", plus the lecturer's other classes at the same time. A warning, never a block. */
function SaveNotice({ notice, weekdays, onDismiss }: { notice: Notice; weekdays: string[]; onDismiss: () => void }) {
  const t = useTranslations('schedule.timetable')
  const { overlaps } = notice
  return (
    <Panel role="status" className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-start gap-2 font-medium">
          {overlaps.length > 0 && (
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          {overlaps.length > 0 ? t('overlapTitle', { count: overlaps.length }) : t('saved')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('dismiss')}
          title={t('dismiss')}
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      {overlaps.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {overlaps.map((o, index) => (
            <li key={`${o.courseId}-${o.weekday}-${o.startMinute}-${index}`}>
              {t('overlapRow', {
                course: o.courseTitle,
                className: o.className,
                school: o.schoolName,
                day: weekdays[o.weekday - 1],
                time: `${minutesToTime(o.startMinute)}–${minutesToTime(o.endMinute)}`,
              })}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** The course's weekly classes: list, inline edit, remove, and the form to add one. */
export function TimetableEditor({
  courseId,
  slots,
  defaults,
  hasCampusLocation,
  weekdays,
}: {
  courseId: string
  slots: SlotListItem[]
  defaults: SlotFormValues
  hasCampusLocation: boolean
  weekdays: string[]
}) {
  const t = useTranslations('schedule.timetable')
  // Held here, not in the row: an edit can replace the slot (and its row) with a new one.
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <>
      <section aria-labelledby="timetable-slots" className="flex flex-col gap-4">
        <SectionHeading id="timetable-slots">{t('slotsTitle')}</SectionHeading>
        {slots.length === 0 ? (
          <p className="text-muted-foreground">{t('noSlots')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-3xl border">
            {slots.map((slot) => {
              const time = `${slot.start}–${slot.end}`
              return (
                <li key={slot.id} className="flex flex-col gap-4 px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{slot.dayLabel}</span>
                        <span className="font-mono text-sm tabular-nums">{time}</span>
                        {slot.requireOnCampus && <Badge variant="secondary">{t('onCampus')}</Badge>}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {[slot.room, slot.termLabel].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        aria-label={t('editLabel', { day: slot.dayLabel, time })}
                        aria-expanded={editing === slot.id}
                        onClick={() => setEditing(editing === slot.id ? null : slot.id)}
                      >
                        <Pencil aria-hidden="true" data-icon="inline-start" />
                        {t('edit')}
                      </Button>
                      <ConfirmAction
                        action={() => removeSlotAction(slot.id)}
                        fields={{}}
                        triggerLabel={t('remove')}
                        triggerAriaLabel={t('removeLabel', { day: slot.dayLabel, time })}
                        triggerIcon={<Trash2 aria-hidden="true" data-icon="inline-start" />}
                        title={t('removeTitle')}
                        body={t('removeBody')}
                        confirmLabel={t('removeConfirm')}
                        destructive
                      />
                    </div>
                  </div>
                  {editing === slot.id && (
                    <div className="rounded-2xl bg-muted/50 p-4 sm:p-5">
                      <SlotForm
                        target={{ kind: 'edit', slotId: slot.id }}
                        initial={slot}
                        hasCampusLocation={hasCampusLocation}
                        weekdays={weekdays}
                        onSaved={(saved) => {
                          setEditing(null)
                          setNotice(saved)
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Between the list and the form, so it is seen after adding as well as after editing. */}
      {notice && <SaveNotice notice={notice} weekdays={weekdays} onDismiss={() => setNotice(null)} />}

      <section aria-labelledby="timetable-add" className="flex flex-col gap-4">
        <SectionHeading id="timetable-add">{t('addTitle')}</SectionHeading>
        <Panel>
          <SlotForm
            target={{ kind: 'create', courseId }}
            initial={defaults}
            hasCampusLocation={hasCampusLocation}
            weekdays={weekdays}
            onSaved={setNotice}
          />
        </Panel>
      </section>
    </>
  )
}
