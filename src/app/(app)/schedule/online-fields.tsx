'use client'

import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { isInvalidField } from '@/components/action-error'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import type { ClassroomOption } from '@/lib/classroom-option'
import { ClassroomButton } from './classroom-button'

/**
 * The course's classroom as an online-class form sees it. `onSave` is the new-course form's: the course does not
 * exist yet, and the classroom is made with it when the form is saved (Google already allows it).
 */
export type OnlineClassroom = ClassroomOption | { state: 'onSave' }

/**
 * The online switch and where the link comes from: the course's classroom (posted as `autoMeet=on`) or a pasted
 * Google Meet URL. With the classroom hidden, only the pasted link. Rendered by the timetable, make-up,
 * move-online and course-creation forms.
 */
export function OnlineFields({
  idPrefix,
  state,
  online,
  setOnline,
  autoMeet,
  setAutoMeet,
  meetingUrl,
  setMeetingUrl,
  classroom,
  title,
  hint,
  alwaysOnline = false,
}: {
  idPrefix: string
  state: ActionResult<unknown> | null
  online: boolean
  setOnline: (value: boolean) => void
  /**
   * The classroom is chosen. Null until the lecturer picks: the classroom when it is ready (or made on save), or
   * when they are back from Google to finish creating it; otherwise the pasted link.
   */
  autoMeet: boolean | null
  setAutoMeet: (value: boolean) => void
  meetingUrl: string
  setMeetingUrl: (value: string) => void
  classroom: OnlineClassroom
  /** Course creation uses the switch to reveal the first slot's fields. */
  title?: string
  hint?: string
  /** "Move online" is already online: keep the link choices, without a second tick. */
  alwaysOnline?: boolean
}) {
  const t = useTranslations('schedule.online')
  const invalid = (field: string) => isInvalidField(state, field) || undefined
  const backFromGoogle = useSearchParams().get('classroom') === 'google'
  const offered = classroom.state !== 'hidden'
  const classroomByDefault =
    classroom.state === 'ready' || classroom.state === 'onSave' || (classroom.state === 'missing' && backFromGoogle)
  const useClassroom = offered && (autoMeet ?? classroomByDefault)

  const linkField = (
    <Field data-invalid={invalid('meetingUrl')}>
      <FieldLabel htmlFor={`${idPrefix}-meetingUrl`}>{t('meetingUrl')}</FieldLabel>
      <Input
        id={`${idPrefix}-meetingUrl`}
        name="meetingUrl"
        type="url"
        inputMode="url"
        maxLength={2048}
        required
        value={meetingUrl}
        onChange={(e) => setMeetingUrl(e.target.value)}
        placeholder={t('meetingUrlPlaceholder')}
        aria-invalid={invalid('meetingUrl')}
      />
    </Field>
  )

  return (
    <>
      {alwaysOnline ? (
        <input type="hidden" name="online" value="on" />
      ) : (
        <label htmlFor={`${idPrefix}-online`} className="flex items-start gap-3">
          <input
            id={`${idPrefix}-online`}
            name="online"
            type="checkbox"
            checked={online}
            onChange={(e) => setOnline(e.target.checked)}
            aria-describedby={`${idPrefix}-online-hint`}
            className="mt-0.5 size-5 shrink-0 accent-primary"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{title ?? t('title')}</span>
            <span id={`${idPrefix}-online-hint`} className="text-sm text-muted-foreground">
              {hint ?? t('hint')}
            </span>
          </span>
        </label>
      )}

      {(alwaysOnline || online) &&
        (offered ? (
          <div role="radiogroup" aria-label={t('title')} className="flex flex-col gap-4">
            {useClassroom && <input type="hidden" name="autoMeet" value="on" />}
            <div className="flex flex-col gap-3">
              <label htmlFor={`${idPrefix}-use-classroom`} className="flex items-start gap-3">
                <input
                  id={`${idPrefix}-use-classroom`}
                  name="meetSource"
                  type="radio"
                  value="classroom"
                  checked={useClassroom}
                  onChange={() => setAutoMeet(true)}
                  aria-describedby={`${idPrefix}-classroom-hint`}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{t('useClassroom')}</span>
                  <span id={`${idPrefix}-classroom-hint`} className="text-sm text-muted-foreground">
                    {t('useClassroomHint')}
                  </span>
                </span>
              </label>
              {useClassroom && classroom.state === 'missing' && (
                <div className="pl-8">
                  <ClassroomButton courseId={classroom.courseId} googleGranted={classroom.googleGranted} />
                </div>
              )}
              {useClassroom && classroom.state === 'ready' && !classroom.knockingConfirmed && (
                <p className="pl-8 text-sm text-muted-foreground">{t('quickAccessTip')}</p>
              )}
            </div>
            <label htmlFor={`${idPrefix}-paste-link`} className="flex items-start gap-3">
              <input
                id={`${idPrefix}-paste-link`}
                name="meetSource"
                type="radio"
                value="link"
                checked={!useClassroom}
                onChange={() => setAutoMeet(false)}
                className="mt-0.5 size-5 shrink-0 accent-primary"
              />
              <span className="font-medium">{t('pasteLink')}</span>
            </label>
            {!useClassroom && <div className="pl-8">{linkField}</div>}
          </div>
        ) : (
          linkField
        ))}
    </>
  )
}
