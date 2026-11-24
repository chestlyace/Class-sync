'use client'

import { BadgeCheck, UserRoundCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import type { ErrorCode } from '@/server/core/errors'
import { setDelegateAction } from './actions'

/**
 * On the class roster: make a student a class delegate, or end it. A delegate runs attendance
 * for every course of the class. At most two per class: the server says so if the limit is hit.
 */
export function DelegateButton({
  classId,
  studentId,
  name,
  isDelegate,
  full,
}: {
  classId: string
  studentId: string
  name: string
  isDelegate: boolean
  /** The class already has its two delegates (and this student isn't one). */
  full: boolean
}) {
  const t = useTranslations('classes.page.delegates')
  const [pending, start] = useTransition()
  const [error, setError] = useState<{ code: ErrorCode; reason?: unknown } | null>(null)

  const toggle = () =>
    start(async () => {
      setError(null)
      const result = await setDelegateAction(classId, studentId, !isDelegate)
      if (!result.ok) setError({ code: result.code, reason: result.details?.reason })
    })

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={isDelegate ? 'outline' : 'ghost'}
        size="sm"
        pending={pending}
        disabled={!isDelegate && full}
        title={!isDelegate && full ? t('full') : undefined}
        aria-label={isDelegate ? t('removeLabel', { name }) : t('makeLabel', { name })}
        onClick={toggle}
      >
        {isDelegate ? (
          <BadgeCheck aria-hidden="true" data-icon="inline-start" />
        ) : (
          <UserRoundCheck aria-hidden="true" data-icon="inline-start" />
        )}
        {isDelegate ? t('remove') : t('make')}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error.reason === 'max_delegates' ? t('full') : <ErrorCodeMessage code={error.code} />}
        </span>
      )}
    </span>
  )
}
