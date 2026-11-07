'use client'

import { useTranslations } from 'next-intl'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import type { ErrorCode } from '@/server/core/errors'

/** The translated message for a failed action; `overrides` replaces the generic text per code. */
export function ActionError({
  state,
  overrides,
}: {
  state: ActionResult<unknown> | null
  overrides?: Partial<Record<ErrorCode, React.ReactNode>>
}) {
  const t = useTranslations('errors')
  if (!state || state.ok) return null
  return <FieldError>{overrides?.[state.code] ?? t(state.code)}</FieldError>
}

/** True when a failed VALIDATION result names `field` (for aria-invalid). */
export function isInvalidField(state: ActionResult<unknown> | null, field: string): boolean {
  if (!state || state.ok || state.code !== 'VALIDATION') return false
  const fields = state.details?.fields
  return Array.isArray(fields) && fields.includes(field)
}
