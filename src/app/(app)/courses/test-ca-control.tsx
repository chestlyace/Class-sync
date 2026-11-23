'use client'

import { useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { NativeSelect } from '@/components/ui/native-select'
import type { ErrorCode } from '@/server/core/errors'
import { cn } from '@/lib/utils'
import { setTestCaAction } from './test-actions'

/**
 * On a test's page: whether it counts in the CA (off: a practice test) and, when the course has
 * named CAs, which one. Changeable at any time, even after release: the CA recalculates. Changes
 * at once and goes back if the save fails.
 */
export function TestCaControl({
  testId,
  initial,
  caGroups,
}: {
  testId: string
  initial: { countsInCa: boolean; caGroupId: string | null }
  caGroups: { id: string; name: string }[]
}) {
  const t = useTranslations('tests.ca')
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, startTransition] = useTransition()
  const labelId = useId()
  const helpId = useId()
  const groupId = useId()

  const save = (next: typeof value) => {
    const before = value
    setValue(next)
    setError(null)
    startTransition(async () => {
      const result = await setTestCaAction(testId, next)
      if (!result.ok) {
        setValue(before)
        setError(result.code)
      }
    })
  }

  return (
    <div data-testid="test-ca-control" className="flex flex-col gap-3 rounded-3xl border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span id={labelId} className="font-medium">
            {t('switchLabel')}
          </span>
          <p id={helpId} className="text-sm text-muted-foreground">
            {value.countsInCa ? t('onHelp') : t('offHelp')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value.countsInCa}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          aria-busy={pending}
          onClick={() => save({ ...value, countsInCa: !value.countsInCa })}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            value.countsInCa ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-block size-6 rounded-full bg-background shadow-sm transition-transform',
              value.countsInCa ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>
      {value.countsInCa && caGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={groupId} className="text-sm font-medium">
            {t('groupLabel')}
          </label>
          <NativeSelect
            id={groupId}
            value={value.caGroupId ?? caGroups[0].id}
            disabled={pending}
            onChange={(e) => save({ ...value, caGroupId: e.target.value })}
          >
            {caGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          <ErrorCodeMessage code={error} />
        </p>
      )}
    </div>
  )
}
