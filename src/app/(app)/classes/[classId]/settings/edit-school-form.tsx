'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { submitWith } from '@/lib/form-submit'
import { updateSchoolAction } from '../../actions'

export function EditSchoolForm({
  classId,
  school,
}: {
  classId: string
  school: { id: string; name: string; town: string }
}) {
  const t = useTranslations('schools.new')
  const tSettings = useTranslations('classes.settings')
  const [state, dispatch, pending] = useActionState(updateSchoolAction, null)
  const invalid = (field: string) => isInvalidField(state, field) || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="schoolId" value={school.id} />
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid('name')}>
            <FieldLabel htmlFor="school-name">{t('name')}</FieldLabel>
            <Input id="school-name" name="name" maxLength={120} defaultValue={school.name} aria-invalid={invalid('name')} />
          </Field>
          <Field data-invalid={invalid('town')}>
            <FieldLabel htmlFor="school-town">{t('town')}</FieldLabel>
            <Input id="school-town" name="town" maxLength={120} defaultValue={school.town} aria-invalid={invalid('town')} />
          </Field>
        </div>
        <ActionError state={state} overrides={{ CONFLICT: tSettings('schoolConflict') }} />
      </FieldGroup>
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? tSettings('saving') : tSettings('save')}
      </Button>
    </form>
  )
}
