import { unstable_rethrow } from 'next/navigation'
import { AppError, type ErrorCode } from '@/server/core/errors'

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; details?: Record<string, unknown> }

/**
 * Runs a Server Action body and turns an `AppError` into a failed result the form can show as
 * `t('errors.' + code)`. Anything else is rethrown: Next's own control-flow errors (`redirect()`,
 * `notFound()`, …) must reach the framework, and unexpected errors must not be swallowed.
 */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    unstable_rethrow(err)
    if (!(err instanceof AppError)) throw err
    return err.details === undefined
      ? { ok: false, code: err.code }
      : { ok: false, code: err.code, details: err.details }
  }
}
