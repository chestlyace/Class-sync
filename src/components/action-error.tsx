'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
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
  if (!state || state.ok) return null
  return <FieldError>{overrides?.[state.code] ?? <ErrorCodeMessage code={state.code} />}</FieldError>
}

/**
 * The translated text for an error code. When the session has expired (UNAUTHENTICATED) the
 * message comes with a link to sign in again.
 */
export function ErrorCodeMessage({ code }: { code: ErrorCode }) {
  const t = useTranslations()
  if (code !== 'UNAUTHENTICATED') return t(`errors.${code}`)
  return (
    <>
      {t('errors.UNAUTHENTICATED')}{' '}
      <Link href="/sign-in" className="font-medium underline underline-offset-4">
        {t('nav.signIn')}
      </Link>
    </>
  )
}

/** True when a failed VALIDATION result names `field` (for aria-invalid). */
export function isInvalidField(state: ActionResult<unknown> | null, field: string): boolean {
  if (!state || state.ok || state.code !== 'VALIDATION') return false
  const fields = state.details?.fields
  return Array.isArray(fields) && fields.includes(field)
}
