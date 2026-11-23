'use client'

import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import type { ActionResult } from '@/lib/action-result'
import { cn } from '@/lib/utils'
import { setAnnouncementsAction } from './actions'

/**
 * Settings → Notifications: whether Clasync may email announcements to this account (every role).
 * Saves on change; the switch flips at once and flips back on an error. Account emails (sign-in,
 * verification, password reset) are not affected.
 */
export function AnnouncementsSwitch({ initial }: { initial: boolean }) {
  const t = useTranslations('settings.announcements')
  const tCommon = useTranslations('common')
  const [checked, setChecked] = useState(initial)
  const [pending, setPending] = useState(false)
  // An error result, or 'unexpected' for a network failure or an unexpected server error.
  const [error, setError] = useState<ActionResult<null> | 'unexpected' | null>(null)
  const titleId = useId()
  const hintId = useId()

  async function change(next: boolean) {
    // While saving the switch stays focusable (aria-disabled, not disabled) and ignores clicks.
    if (pending) return
    const previous = checked
    setChecked(next)
    setPending(true)
    setError(null)
    try {
      const result = await setAnnouncementsAction(next)
      if (!result.ok) {
        setChecked(previous)
        setError(result)
      }
    } catch {
      setChecked(previous)
      setError('unexpected')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        aria-disabled={pending}
        onClick={() => change(!checked)}
        className="flex min-h-11 items-start gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:opacity-70"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors',
            checked ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'size-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none',
              checked ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>
        <span className="flex flex-col gap-0.5">
          <span id={titleId} className="font-semibold">
            {t('title')}
          </span>
          <span id={hintId} className="text-sm text-muted-foreground">
            {t('hint')}
          </span>
        </span>
      </button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error === 'unexpected' ? tCommon('genericError') : error.ok ? null : <ErrorCodeMessage code={error.code} />}
        </p>
      )}
    </div>
  )
}
