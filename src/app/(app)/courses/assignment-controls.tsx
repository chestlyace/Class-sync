'use client'

import { Check, Save, Send, Trash2, Unlock } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { isInvalidField } from '@/components/action-error'
import { ConfirmAction } from '@/components/confirm-action'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { formatDecimal } from '@/lib/number-format'
import { FEEDBACK_MAX, MARK_STEP } from '@/server/assignments/rules'
import {
  deleteDraftAssignmentAction,
  gradeSubmissionAction,
  publishAssignmentAction,
  releaseGradesAction,
} from './assignment-actions'
import { AssignmentError } from './assignment-error'

const renderError = (state: ActionResult<unknown> | null) => <AssignmentError state={state} />

/** Publish (with a confirmation saying the roster is emailed). */
export function PublishButton({ assignmentId, rosterSize }: { assignmentId: string; rosterSize: number }) {
  const t = useTranslations('assignments.lecturer.detail')
  return (
    <ConfirmAction
      action={() => publishAssignmentAction(assignmentId)}
      fields={{}}
      primary
      triggerLabel={t('publish')}
      triggerIcon={<Send aria-hidden="true" data-icon="inline-start" />}
      title={t('publishTitle')}
      body={t('publishBody', { count: rosterSize })}
      confirmLabel={t('publishConfirm')}
      renderError={renderError}
    />
  )
}

export function DeleteDraftButton({ assignmentId, courseId }: { assignmentId: string; courseId: string }) {
  const t = useTranslations('assignments.lecturer.detail')
  return (
    <ConfirmAction
      action={() => deleteDraftAssignmentAction(assignmentId, courseId)}
      fields={{}}
      destructive
      triggerLabel={t('deleteDraft')}
      triggerIcon={<Trash2 aria-hidden="true" data-icon="inline-start" />}
      title={t('deleteTitle')}
      body={t('deleteBody')}
      confirmLabel={t('deleteConfirm')}
      renderError={renderError}
    />
  )
}

/**
 * Release grades; the dialog says how many submissions are graded and how many are not, that
 * releasing closes hand-ins (ruling B9), and warns when the deadline has not passed yet.
 */
export function ReleaseGradesButton({
  assignmentId,
  graded,
  ungraded,
  beforeDeadline,
}: {
  assignmentId: string
  graded: number
  ungraded: number
  beforeDeadline: boolean
}) {
  const t = useTranslations('assignments.lecturer.detail')
  return (
    <ConfirmAction
      action={() => releaseGradesAction(assignmentId)}
      fields={{}}
      primary
      triggerLabel={t('release')}
      triggerIcon={<Unlock aria-hidden="true" data-icon="inline-start" />}
      title={t('releaseTitle')}
      body={`${t('releaseBody', { graded })} ${t('releaseCloses')}`}
      note={ungraded > 0 ? t('releaseUngraded', { count: ungraded }) : undefined}
      warning={beforeDeadline ? t('releaseBeforeDeadline') : undefined}
      confirmLabel={t('releaseConfirm')}
      renderError={renderError}
    />
  )
}

/**
 * Mark (0..maxMark in steps of 0.25) and feedback for one submission. `submittedAt` (ISO) is the
 * version shown on the page; saving is refused if the student has handed in a new one since.
 */
export function GradeForm({
  submissionId,
  submittedAt,
  maxMark,
  mark,
  feedback,
}: {
  submissionId: string
  submittedAt: string
  maxMark: number
  mark: number | null
  feedback: string | null
}) {
  const t = useTranslations('assignments.lecturer.grade')
  const locale = useLocale()
  const max = formatDecimal(maxMark, locale)
  const [state, dispatch, pending] = useActionState(
    (prev: ActionResult<null> | null, data: FormData) => gradeSubmissionAction(submissionId, prev, data),
    null,
  )
  const invalid = (field: string) => isInvalidField(state, field) || undefined

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <input type="hidden" name="submittedAt" value={submittedAt} />
      <FieldGroup>
        <Field data-invalid={invalid('mark')}>
          <FieldLabel htmlFor="grade-mark">{t('mark')}</FieldLabel>
          <div className="flex items-center gap-3">
            <Input
              id="grade-mark"
              name="mark"
              type="number"
              inputMode="decimal"
              required
              min={0}
              max={maxMark}
              step={MARK_STEP}
              defaultValue={mark ?? ''}
              aria-invalid={invalid('mark')}
              aria-describedby="grade-mark-hint"
              className="w-32 font-mono"
            />
            <span aria-hidden="true" className="font-mono text-muted-foreground">
              / {max}
            </span>
          </div>
          <FieldDescription id="grade-mark-hint">{t('markHint', { max, step: formatDecimal(MARK_STEP, locale) })}</FieldDescription>
        </Field>
        <Field data-invalid={invalid('feedback')}>
          <FieldLabel htmlFor="grade-feedback">{t('feedback')}</FieldLabel>
          <textarea
            id="grade-feedback"
            name="feedback"
            rows={5}
            maxLength={FEEDBACK_MAX}
            defaultValue={feedback ?? ''}
            aria-invalid={invalid('feedback')}
            aria-describedby="grade-feedback-hint"
            className="w-full min-w-0 rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
          />
          <FieldDescription id="grade-feedback-hint">{t('feedbackHint', { max: FEEDBACK_MAX })}</FieldDescription>
        </Field>
        <AssignmentError state={state} maxMark={maxMark} />
      </FieldGroup>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Save aria-hidden="true" data-icon="inline-start" />
          {pending ? t('saving') : t('save')}
        </Button>
        {state?.ok && !pending && (
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Check aria-hidden="true" className="size-4" />
            {t('saved')}
          </span>
        )}
      </div>
    </form>
  )
}
