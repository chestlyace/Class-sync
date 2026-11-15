'use client'

import { useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import type { ErrorCode } from '@/server/core/errors'
import { cn } from '@/lib/utils'
import { setStudentsCanReviewAction } from './test-actions'

/**
 * "Let students review this test": the lecturer's per-test switch, changeable at any time. Flips at
 * once and goes back if the save fails.
 */
export function ReviewSwitch({ testId, initial }: { testId: string; initial: boolean }) {
  const t = useTranslations('tests.review')
  const [on, setOn] = useState(initial)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, startTransition] = useTransition()
  const labelId = useId()
  const helpId = useId()

  const toggle = () => {
    const next = !on
    setOn(next)
    setError(null)
    startTransition(async () => {
      const result = await setStudentsCanReviewAction(testId, next)
      if (!result.ok) {
        setOn(!next)
        setError(result.code)
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-3xl border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span id={labelId} className="font-medium">
            {t('switchLabel')}
          </span>
          <p id={helpId} className="text-sm text-muted-foreground">
            {t('switchHelp')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          aria-busy={pending}
          onClick={toggle}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            on ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none block size-6 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none',
              on ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          <ErrorCodeMessage code={error} />
        </p>
      )}
    </div>
  )
}
