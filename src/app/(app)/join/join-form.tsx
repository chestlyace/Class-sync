'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { submitWith } from '@/lib/form-submit'
import type { Role } from '@/server/core/context'
import { joinClassAction } from './actions'

/**
 * The join form. With `confirm` (opened from a join link whose class is known), the code is not
 * asked for: the button names the class, and students only add their matricule, prefilled from
 * another class of the same school when there is one.
 */
export function JoinForm({
  role,
  defaultCode,
  confirm,
}: {
  role: Role
  defaultCode: string
  confirm?: { className: string; suggestedMatricule: string | null }
}) {
  const t = useTranslations('join')
  const [state, dispatch, pending] = useActionState(joinClassAction, null)
  const matriculeInvalid = isInvalidField(state, 'matricule') || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        {confirm ? (
          <input type="hidden" name="code" value={defaultCode} />
        ) : (
          <Field>
            <FieldLabel htmlFor="join-code">{t('code')}</FieldLabel>
            <Input
              id="join-code"
              name="code"
              defaultValue={defaultCode}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              aria-describedby="join-code-hint"
              className="max-w-56 font-mono text-lg tracking-[0.2em] uppercase"
            />
            <FieldDescription id="join-code-hint">{t('codeHint')}</FieldDescription>
          </Field>
        )}
        {role === 'student' && (
          <Field data-invalid={matriculeInvalid}>
            <FieldLabel htmlFor="join-matricule">{t('matricule')}</FieldLabel>
            <Input
              id="join-matricule"
              name="matricule"
              defaultValue={confirm?.suggestedMatricule ?? ''}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={30}
              aria-describedby="join-matricule-hint"
              aria-invalid={matriculeInvalid}
              className="max-w-72 font-mono uppercase"
            />
            <FieldDescription id="join-matricule-hint">
              {confirm?.suggestedMatricule ? t('matriculeSuggested') : t('matriculeHint')}
            </FieldDescription>
          </Field>
        )}
        <ActionError state={state} overrides={{ NOT_FOUND: t('notFound'), CONFLICT: t('matriculeTaken') }} />
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? t('submitting') : confirm ? t('confirmSubmit', { className: confirm.className }) : t('submit')}
      </Button>
    </form>
  )
}
