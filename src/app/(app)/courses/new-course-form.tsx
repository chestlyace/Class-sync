'use client'

import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { submitWith } from '@/lib/form-submit'
import { createCourseAction } from './actions'

export type ClassOption = { id: string; label: string }

export function NewCourseForm({ classes, defaultClassId }: { classes: ClassOption[]; defaultClassId: string }) {
  const t = useTranslations('courses.new')
  const tCommon = useTranslations('common')
  const [state, dispatch, pending] = useActionState(createCourseAction, null)
  const invalid = (field: string) => isInvalidField(state, field) || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={invalid('classId')}>
          <FieldLabel htmlFor="course-class">{t('class')}</FieldLabel>
          <NativeSelect id="course-class" name="classId" defaultValue={defaultClassId} aria-invalid={invalid('classId')}>
            <option value="" disabled>
              {t('chooseClass')}
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={invalid('title')}>
          <FieldLabel htmlFor="course-title">{t('courseTitle')}</FieldLabel>
          <Input
            id="course-title"
            name="title"
            maxLength={120}
            placeholder={t('courseTitlePlaceholder')}
            aria-invalid={invalid('title')}
          />
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
              placeholder={t('codePlaceholder')}
              aria-invalid={invalid('code')}
              className="font-mono uppercase"
            />
          </Field>
          <Field data-invalid={invalid('semester')}>
            <FieldLabel htmlFor="course-semester">{t('semester')}</FieldLabel>
            <NativeSelect id="course-semester" name="semester" defaultValue="1" aria-invalid={invalid('semester')}>
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
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
