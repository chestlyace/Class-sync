'use client'

import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { OnlineFields } from '../schedule/online-fields'
import { createCourseAction } from './actions'

export type ClassOption = { id: string; label: string }

export function NewCourseForm({
  classes,
  defaultClassId,
  weekdays,
  classroom,
  firstSlotDefaults,
}: {
  classes: ClassOption[]
  defaultClassId: string
  weekdays: string[]
  /** `offer`: the first online class can use a classroom made on save; `later`: say it can be added afterwards. */
  classroom: { offer: boolean; later: boolean }
  firstSlotDefaults: { startsOn: string; endsOn: string }
}) {
  const t = useTranslations('courses.new')
  const tSlot = useTranslations('schedule.timetable')
  const tCommon = useTranslations('common')
  const tOnline = useTranslations('schedule.online')
  const [online, setOnline] = useState(false)
  const [autoMeet, setAutoMeet] = useState<boolean | null>(null)
  const [state, dispatch, pending] = useActionState(async (prev: ActionResult<never> | null, data: FormData) => {
    const result = await createCourseAction(prev, data)
    // Google refused to make the room: switch to a pasted link so the lecturer can save now.
    if (!result.ok && result.details?.reason === 'google_permission_needed') setAutoMeet(false)
    return result
  }, null)
  const invalid = (field: string) => isInvalidField(state, field) || undefined
  const googleNeeded = state?.ok === false && state.details?.reason === 'google_permission_needed'
  const [meetingUrl, setMeetingUrl] = useState('')

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={invalid('classId')}>
          <FieldLabel htmlFor="course-class">{t('class')}</FieldLabel>
          <NativeSelect id="course-class" name="classId" defaultValue={defaultClassId} aria-invalid={invalid('classId')}>
            <option value="" disabled>
              {t('chooseClass')}
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={invalid('title')}>
          <FieldLabel htmlFor="course-title">{t('courseTitle')}</FieldLabel>
          <Input
            id="course-title"
            name="title"
            maxLength={120}
            placeholder={t('courseTitlePlaceholder')}
            aria-invalid={invalid('title')}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid('code')}>
            <FieldLabel htmlFor="course-code">
              {t('code')} <span className="font-normal text-muted-foreground">({tCommon('optional')})</span>
            </FieldLabel>
            <Input
              id="course-code"
              name="code"
              maxLength={20}
              autoCapitalize="characters"
              placeholder={t('codePlaceholder')}
              aria-invalid={invalid('code')}
              className="font-mono uppercase"
            />
          </Field>
          <Field data-invalid={invalid('semester')}>
            <FieldLabel htmlFor="course-semester">{t('semester')}</FieldLabel>
            <NativeSelect id="course-semester" name="semester" defaultValue="1" aria-invalid={invalid('semester')}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {t('semesterOption', { n })}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <OnlineFields
          idPrefix="course-first"
          state={state}
          online={online}
          setOnline={setOnline}
          autoMeet={autoMeet}
          setAutoMeet={setAutoMeet}
          meetingUrl={meetingUrl}
          setMeetingUrl={setMeetingUrl}
          classroom={classroom.offer ? { state: 'onSave' } : { state: 'hidden' }}
          title={t('firstSlot')}
          hint={t('firstSlotHint')}
        />
        {online && classroom.later && <FieldDescription className="-mt-2">{tOnline('classroomLater')}</FieldDescription>}
        {online && (
          <>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field data-invalid={invalid('weekday')}>
                <FieldLabel htmlFor="course-weekday">{tSlot('weekday')}</FieldLabel>
                <NativeSelect id="course-weekday" name="weekday" defaultValue="1" required aria-invalid={invalid('weekday')}>
                  {weekdays.map((label, index) => (
                    <option key={label} value={String(index + 1)}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field data-invalid={invalid('startMinute')}>
                <FieldLabel htmlFor="course-start">{tSlot('start')}</FieldLabel>
                <Input
                  id="course-start"
                  name="startMinute"
                  type="time"
                  defaultValue="08:00"
                  required
                  aria-invalid={invalid('startMinute')}
                />
              </Field>
              <Field data-invalid={invalid('endMinute')}>
                <FieldLabel htmlFor="course-end">{tSlot('end')}</FieldLabel>
                <Input
                  id="course-end"
                  name="endMinute"
                  type="time"
                  defaultValue="10:00"
                  required
                  aria-invalid={invalid('endMinute')}
                />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={invalid('startsOn')}>
                <FieldLabel htmlFor="course-starts-on">{tSlot('startsOn')}</FieldLabel>
                <Input
                  id="course-starts-on"
                  name="startsOn"
                  type="date"
                  defaultValue={firstSlotDefaults.startsOn}
                  required
                  aria-invalid={invalid('startsOn')}
                  aria-describedby="course-term-hint"
                />
              </Field>
              <Field data-invalid={invalid('endsOn')}>
                <FieldLabel htmlFor="course-ends-on">{tSlot('endsOn')}</FieldLabel>
                <Input
                  id="course-ends-on"
                  name="endsOn"
                  type="date"
                  defaultValue={firstSlotDefaults.endsOn}
                  required
                  aria-invalid={invalid('endsOn')}
                  aria-describedby="course-term-hint"
                />
              </Field>
            </div>
            <FieldDescription id="course-term-hint" className="-mt-2">
              {tSlot('termHint')}
            </FieldDescription>
          </>
        )}
        {googleNeeded ? (
          <FieldError>
            {tOnline('googleRefused')}
          </FieldError>
        ) : (
          <ActionError state={state} />
        )}
      </FieldGroup>
      <Button type="submit" size="lg" pending={pending} className="self-start">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
