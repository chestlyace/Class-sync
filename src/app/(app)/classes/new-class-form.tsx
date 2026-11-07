'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { submitWith } from '@/lib/form-submit'
import { createClassAction } from './actions'

export function NewClassForm({ schoolId, defaultYear }: { schoolId: string; defaultYear: string }) {
  const t = useTranslations('classes.new')
  const [state, dispatch, pending] = useActionState(createClassAction, null)
  const nameInvalid = isInvalidField(state, 'name') || undefined
  const yearInvalid = isInvalidField(state, 'academicYear') || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="schoolId" value={schoolId} />
      <FieldGroup>
        <Field data-invalid={nameInvalid}>
          <FieldLabel htmlFor="class-name">{t('name')}</FieldLabel>
          <Input
            id="class-name"
            name="name"
            maxLength={120}
            placeholder={t('namePlaceholder')}
            aria-invalid={nameInvalid}
          />
        </Field>
        <Field data-invalid={yearInvalid}>
          <FieldLabel htmlFor="class-year">{t('academicYear')}</FieldLabel>
          <Input
            id="class-year"
            name="academicYear"
            defaultValue={defaultYear}
            inputMode="numeric"
            maxLength={7}
            aria-describedby="class-year-hint"
            aria-invalid={yearInvalid}
            className="max-w-40 font-mono"
          />
          <FieldDescription id="class-year-hint">{t('academicYearHint')}</FieldDescription>
        </Field>
        <ActionError state={state} />
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
