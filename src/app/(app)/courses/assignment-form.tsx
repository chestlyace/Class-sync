'use client'

import { Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { isInvalidField } from '@/components/action-error'
import { FileUploader, type FileInfo } from '@/components/file-uploader'
import { RichTextEditor } from '@/components/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { Locale } from '@/i18n/locale'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { MARK_STEP } from '@/server/assignments/rules'
import { createAssignmentAction, updateAssignmentAction } from './assignment-actions'
import { AssignmentError } from './assignment-error'

/** The form's values; `dueAt` is a `datetime-local` value in the school's time zone. */
export type AssignmentFormValues = {
  title: string
  instructions: unknown
  dueAt: string
  maxMark: number
  weight: number
  submissionMode: 'files' | 'text' | 'both'
  latePolicy: 'accept' | 'close'
  attachments: FileInfo[]
}

const EMPTY: AssignmentFormValues = {
  title: '',
  instructions: [],
  dueAt: '',
  maxMark: 20,
  weight: 1,
  submissionMode: 'files',
  latePolicy: 'accept',
  attachments: [],
}

/**
 * New and edit share this form. A new assignment is saved as a draft without attachments, then
 * opens on its edit page where files can be added (they are stored per assignment).
 */
export function AssignmentForm({
  target,
  initial = EMPTY,
  locale,
  timeZone,
}: {
  target: { kind: 'create'; courseId: string } | { kind: 'edit'; assignmentId: string }
  initial?: AssignmentFormValues
  locale: Locale
  timeZone: string
}) {
  const t = useTranslations('assignments.lecturer.form')
  const tCommon = useTranslations('common')
  const [instructions, setInstructions] = useState<unknown>(initial.instructions)
  const [attachments, setAttachments] = useState<FileInfo[]>(initial.attachments)
  const [uploading, setUploading] = useState(false)
  const [state, dispatch, pending] = useActionState(
    (prev: ActionResult<never> | null, data: FormData) =>
      target.kind === 'create'
        ? createAssignmentAction(target.courseId, prev, data)
        : updateAssignmentAction(target.assignmentId, prev, data),
    null,
  )
  const invalid = (field: string) => isInvalidField(state, field) || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="instructions" value={JSON.stringify(instructions ?? [])} />
      {attachments.map((f) => (
        <input key={f.id} type="hidden" name="attachmentIds" value={f.id} />
      ))}
      <FieldGroup>
        <Field data-invalid={invalid('title')}>
          <FieldLabel htmlFor="assignment-title">{t('title')}</FieldLabel>
          <Input
            id="assignment-title"
            name="title"
            required
            minLength={2}
            maxLength={200}
            defaultValue={initial.title}
            placeholder={t('titlePlaceholder')}
            aria-invalid={invalid('title')}
          />
        </Field>

        <Field data-invalid={invalid('instructions')}>
          <FieldLabel id="assignment-instructions-label">
            {t('instructions')} <span className="font-normal text-muted-foreground">({tCommon('optional')})</span>
          </FieldLabel>
          <RichTextEditor
            value={initial.instructions}
            onChange={setInstructions}
            locale={locale}
            ariaLabel={t('instructions')}
            describedBy="assignment-instructions-hint"
            invalid={invalid('instructions')}
          />
          <FieldDescription id="assignment-instructions-hint">{t('instructionsHint')}</FieldDescription>
        </Field>

        <Field data-invalid={invalid('attachments')}>
          <FieldLabel id="assignment-attachments-label">
            {t('attachments')} <span className="font-normal text-muted-foreground">({tCommon('optional')})</span>
          </FieldLabel>
          {target.kind === 'edit' ? (
            <FileUploader
              purpose="assignment"
              assignmentId={target.assignmentId}
              value={attachments}
              onChange={setAttachments}
              onBusyChange={setUploading}
              labelledBy="assignment-attachments-label"
            />
          ) : (
            <FieldDescription>{t('attachmentsAfterSave')}</FieldDescription>
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field data-invalid={invalid('dueAt')} className="sm:col-span-3">
            <FieldLabel htmlFor="assignment-due">{t('dueAt')}</FieldLabel>
            <Input
              id="assignment-due"
              name="dueAt"
              type="datetime-local"
              required
              defaultValue={initial.dueAt}
              aria-invalid={invalid('dueAt')}
              aria-describedby="assignment-due-hint"
              className="sm:max-w-64"
            />
            <FieldDescription id="assignment-due-hint">{t('dueAtHint', { timeZone })}</FieldDescription>
          </Field>
          <Field data-invalid={invalid('maxMark')}>
            <FieldLabel htmlFor="assignment-max-mark">{t('maxMark')}</FieldLabel>
            <Input
              id="assignment-max-mark"
              name="maxMark"
              type="number"
              inputMode="decimal"
              required
              min={1}
              max={1000}
              step={MARK_STEP}
              defaultValue={initial.maxMark}
              aria-invalid={invalid('maxMark')}
              className="font-mono"
            />
          </Field>
          <Field data-invalid={invalid('weight')}>
            <FieldLabel htmlFor="assignment-weight">{t('weight')}</FieldLabel>
            <Input
              id="assignment-weight"
              name="weight"
              type="number"
              inputMode="decimal"
              required
              min={0.25}
              max={100}
              step={0.25}
              defaultValue={initial.weight}
              aria-invalid={invalid('weight')}
              aria-describedby="assignment-weight-hint"
              className="font-mono"
            />
            <FieldDescription id="assignment-weight-hint">{t('weightHint')}</FieldDescription>
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid('submissionMode')}>
            <FieldLabel htmlFor="assignment-mode">{t('submissionMode')}</FieldLabel>
            <NativeSelect
              id="assignment-mode"
              name="submissionMode"
              defaultValue={initial.submissionMode}
              aria-invalid={invalid('submissionMode')}
              aria-describedby="assignment-mode-hint"
            >
              {(['files', 'text', 'both'] as const).map((mode) => (
                <option key={mode} value={mode}>
                  {t(`mode.${mode}`)}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription id="assignment-mode-hint">{t('modeHint')}</FieldDescription>
          </Field>
          <Field data-invalid={invalid('latePolicy')}>
            <FieldLabel htmlFor="assignment-late">{t('latePolicy')}</FieldLabel>
            <NativeSelect
              id="assignment-late"
              name="latePolicy"
              defaultValue={initial.latePolicy}
              aria-invalid={invalid('latePolicy')}
              aria-describedby="assignment-late-hint"
            >
              {(['accept', 'close'] as const).map((policy) => (
                <option key={policy} value={policy}>
                  {t(`late.${policy}`)}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription id="assignment-late-hint">{t('lateHint')}</FieldDescription>
          </Field>
        </div>

        <AssignmentError state={state} />
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending || uploading}>
          <Save aria-hidden="true" data-icon="inline-start" />
          {pending ? t('saving') : target.kind === 'create' ? t('saveDraft') : t('save')}
        </Button>
        {uploading && <span className="text-sm text-muted-foreground">{t('waitForUploads')}</span>}
      </div>
    </form>
  )
}
