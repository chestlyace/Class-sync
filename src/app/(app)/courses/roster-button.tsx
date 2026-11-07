'use client'

import { useActionState } from 'react'
import { ActionError } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { setRosterAdjustmentAction } from './actions'

/** One roster adjustment (exclude / restore / add / remove) as a small inline form. */
export function RosterButton({
  courseId,
  studentId,
  kind,
  label,
  ariaLabel,
  icon,
  variant = 'outline',
  onSuccess,
}: {
  courseId: string
  studentId: string
  kind: 'include' | 'exclude' | 'clear'
  label: string
  ariaLabel: string
  icon?: React.ReactNode
  variant?: 'outline' | 'default'
  onSuccess?: () => void
}) {
  const [state, dispatch, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof setRosterAdjustmentAction>> | null, data: FormData) => {
      const result = await setRosterAdjustmentAction(prev, data)
      if (result.ok) onSuccess?.()
      return result
    },
    null,
  )
  return (
    <form action={dispatch} className="flex flex-col items-end gap-1">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" size="sm" variant={variant} disabled={pending} aria-label={ariaLabel} title={ariaLabel}>
        {icon}
        {label}
      </Button>
      <ActionError state={state} />
    </form>
  )
}
