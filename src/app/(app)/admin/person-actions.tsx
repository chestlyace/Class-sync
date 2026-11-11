'use client'

import { Ban, LogOut, MailCheck, RotateCcw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'
import { ConfirmAction } from '@/components/confirm-action'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { resendVerificationAction, revokeSessionsAction, suspendAction, unsuspendAction } from './actions'

const REASON_MAX = 500

type Action = (targetId: string, reason?: string) => Promise<ActionResult<null>>

/** The optional reason, saved with the action in the audit log. */
function ReasonField() {
  const t = useTranslations('admin.actions')
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('reason')}</FieldLabel>
      <Input id={id} name="reason" maxLength={REASON_MAX} autoComplete="off" aria-describedby={`${id}-hint`} />
      <FieldDescription id={`${id}-hint`}>{t('reasonHint')}</FieldDescription>
    </Field>
  )
}

function submitFor(targetId: string) {
  return (action: Action) => async (_prev: ActionResult<unknown> | null, data: FormData) =>
    action(targetId, String(data.get('reason') ?? ''))
}

const NO_FIELDS = {}

/**
 * The actions an admin can take on one account, each behind a confirmation with an optional
 * reason. The page decides which apply; only those are passed in.
 */
export function PersonActions({
  targetId,
  name,
  email,
  canSuspend,
  canUnsuspend,
  canRevoke,
  canResend,
}: {
  targetId: string
  name: string
  email: string
  canSuspend: boolean
  canUnsuspend: boolean
  canRevoke: boolean
  canResend: boolean
}) {
  const t = useTranslations('admin.actions')
  const submit = submitFor(targetId)
  const fields = NO_FIELDS
  return (
    <div className="flex flex-wrap gap-2.5">
      {canResend && (
        <ConfirmAction
          action={submit(resendVerificationAction)}
          fields={fields}
          triggerLabel={t('resend.trigger')}
          triggerIcon={<MailCheck aria-hidden="true" data-icon="inline-start" />}
          title={t('resend.title')}
          body={t('resend.body', { email })}
          confirmLabel={t('resend.confirm')}
        >
          <ReasonField />
        </ConfirmAction>
      )}
      {canRevoke && (
        <ConfirmAction
          action={submit(revokeSessionsAction)}
          fields={fields}
          triggerLabel={t('revoke.trigger')}
          triggerIcon={<LogOut aria-hidden="true" data-icon="inline-start" />}
          title={t('revoke.title', { name })}
          body={t('revoke.body')}
          confirmLabel={t('revoke.confirm')}
        >
          <ReasonField />
        </ConfirmAction>
      )}
      {canUnsuspend && (
        <ConfirmAction
          action={submit(unsuspendAction)}
          fields={fields}
          triggerLabel={t('unsuspend.trigger')}
          triggerIcon={<RotateCcw aria-hidden="true" data-icon="inline-start" />}
          title={t('unsuspend.title', { name })}
          body={t('unsuspend.body')}
          confirmLabel={t('unsuspend.confirm')}
        >
          <ReasonField />
        </ConfirmAction>
      )}
      {canSuspend && (
        <ConfirmAction
          action={submit(suspendAction)}
          fields={fields}
          triggerLabel={t('suspend.trigger')}
          triggerIcon={<Ban aria-hidden="true" data-icon="inline-start" />}
          title={t('suspend.title', { name })}
          body={t('suspend.body')}
          confirmLabel={t('suspend.confirm')}
          destructive
        >
          <ReasonField />
        </ConfirmAction>
      )}
    </div>
  )
}
