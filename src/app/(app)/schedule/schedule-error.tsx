'use client'

import { useTranslations } from 'next-intl'
import { ActionError } from '@/components/action-error'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'

const ERROR_REASONS: Record<
  string,
  'outsideClassTime' | 'noCampusLocation' | 'notFuture' | 'alreadySet' | 'notCancelled' | 'notEnded'
> = {
  outside_class_time: 'outsideClassTime',
  no_campus_location: 'noCampusLocation',
  not_future: 'notFuture',
  already_set: 'alreadySet',
  not_cancelled: 'notCancelled',
  not_ended: 'notEnded',
}

/** A failed schedule action; the service's known `reason`s get their own message. */
export function ScheduleError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('schedule.errors')
  if (!state || state.ok) return null
  const reason = typeof state.details?.reason === 'string' ? ERROR_REASONS[state.details.reason] : undefined
  if (reason) return <FieldError>{t(reason)}</FieldError>
  return <ActionError state={state} />
}
