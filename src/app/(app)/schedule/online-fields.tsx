'use client'

import { useTranslations } from 'next-intl'
import { isInvalidField } from '@/components/action-error'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'

/**
 * The online switch and its one link source: paste a Google Meet URL, or let the platform generate a fresh one
 * per class. Rendered by the timetable, make-up, move-online and course-creation forms.
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
  autoMeetAvailable,
  title,
  hint,
  alwaysOnline = false,
}: {
  idPrefix: string
  state: ActionResult<unknown> | null
  online: boolean
  setOnline: (value: boolean) => void
  autoMeet: boolean
  setAutoMeet: (value: boolean) => void
  meetingUrl: string
  setMeetingUrl: (value: string) => void
  autoMeetAvailable: boolean
  /** Course creation uses the switch to reveal the first slot's fields. */
  title?: string
  hint?: string
  /** "Move online" is already online: keep the link choices, without a second tick. */
  alwaysOnline?: boolean
}) {
  const t = useTranslations('schedule.online')
  const invalid = (field: string) => isInvalidField(state, field) || undefined

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

      {(alwaysOnline || online) && (
        <>
          <label
            htmlFor={`${idPrefix}-autoMeet`}
            className="flex items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              id={`${idPrefix}-autoMeet`}
              name="autoMeet"
              type="checkbox"
              checked={autoMeet}
              disabled={!autoMeetAvailable}
              onChange={(e) => {
                const checked = e.target.checked
                setAutoMeet(checked)
                if (checked) setMeetingUrl('')
              }}
              aria-describedby={`${idPrefix}-auto-hint`}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('auto')}</span>
              <span id={`${idPrefix}-auto-hint`} className="text-sm text-muted-foreground">
                {autoMeetAvailable ? t('autoHint') : t('autoUnavailable')}
              </span>
            </span>
          </label>

          {!autoMeet && (
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
          )}
        </>
      )}
    </>
  )
}

/** A short note for forms (such as the course form) that have no place for a disabled checkbox. */
export function AutoMeetHint({ id }: { id?: string }) {
  const t = useTranslations('schedule.online')
  return (
    <FieldDescription id={id} className="-mt-2 text-sm text-muted-foreground">
      {t('autoHint')}
    </FieldDescription>
  )
}
