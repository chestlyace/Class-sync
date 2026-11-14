'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { submitWith } from '@/lib/form-submit'
import { updateCourseAction } from '../../actions'

export function EditCourseForm({
  course,
}: {
  course: { id: string; title: string; code: string | null; semester: number }
}) {
  const t = useTranslations('courses.new')
  const tSettings = useTranslations('courses.settings')
  const tCommon = useTranslations('common')
  const [state, dispatch, pending] = useActionState(updateCourseAction, null)
  const invalid = (field: string) => isInvalidField(state, field) || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="courseId" value={course.id} />
      <FieldGroup>
        <Field data-invalid={invalid('title')}>
          <FieldLabel htmlFor="course-title">{t('courseTitle')}</FieldLabel>
          <Input id="course-title" name="title" maxLength={120} defaultValue={course.title} aria-invalid={invalid('title')} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid('code')}>
            <FieldLabel htmlFor="course-code">
              {t('code')} <span className="font-normal text-muted-foreground">({tCommon('optional')})</span>
            </FieldLabel>
            <Input
              id="course-code"
              name="code"
              maxLength={20}
              autoCapitalize="characters"
              defaultValue={course.code ?? ''}
              placeholder={t('codePlaceholder')}
              aria-invalid={invalid('code')}
              className="font-mono uppercase"
            />
          </Field>
          <Field data-invalid={invalid('semester')}>
            <FieldLabel htmlFor="course-semester">{t('semester')}</FieldLabel>
            <NativeSelect
              id="course-semester"
              name="semester"
              defaultValue={String(course.semester)}
              aria-invalid={invalid('semester')}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {t('semesterOption', { n })}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <ActionError state={state} />
      </FieldGroup>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? tSettings('saving') : tSettings('save')}
      </Button>
    </form>
  )
}
