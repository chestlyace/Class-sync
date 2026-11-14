'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { submitWith } from '@/lib/form-submit'
import { updateClassAction } from '../../actions'

export function EditClassForm({ cls }: { cls: { id: string; name: string; academicYear: string } }) {
  const t = useTranslations('classes.new')
  const tSettings = useTranslations('classes.settings')
  const [state, dispatch, pending] = useActionState(updateClassAction, null)
  const invalid = (field: string) => isInvalidField(state, field) || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="classId" value={cls.id} />
      <FieldGroup>
        <Field data-invalid={invalid('name')}>
          <FieldLabel htmlFor="class-name">{t('name')}</FieldLabel>
          <Input id="class-name" name="name" maxLength={120} defaultValue={cls.name} aria-invalid={invalid('name')} />
        </Field>
        <Field data-invalid={invalid('academicYear')}>
          <FieldLabel htmlFor="class-year">{t('academicYear')}</FieldLabel>
          <Input
            id="class-year"
            name="academicYear"
            defaultValue={cls.academicYear}
            inputMode="numeric"
            maxLength={7}
            aria-invalid={invalid('academicYear')}
            className="font-mono"
          />
          <FieldDescription>{t('academicYearHint')}</FieldDescription>
        </Field>
        <ActionError state={state} />
      </FieldGroup>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? tSettings('saving') : tSettings('save')}
      </Button>
    </form>
  )
}
