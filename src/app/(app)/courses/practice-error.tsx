'use client'

import { useTranslations } from 'next-intl'
import { ActionError } from '@/components/action-error'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import { EXPLANATION_MAX, MAX_PRACTICE_PER_TOPIC } from '@/server/revision/rules'
import { GUIDE_MAX, MCQ_OPTIONS_MAX, MCQ_OPTIONS_MIN, PROMPT_MAX } from '@/server/tests/rules'

const FIELDS = ['prompt', 'options', 'guide', 'explanation', 'kind'] as const

const CONFLICT_REASONS = {
  too_many: 'tooMany',
  not_ended: 'notEnded',
  already_imported: 'alreadyImported',
} as const

/** A failed practice action, explained: the field that is wrong, or the service's reason. */
export function PracticeError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('revision.errors')
  if (!state || state.ok) return null
  if (state.code === 'VALIDATION') {
    const fields = state.details?.fields
    const field = Array.isArray(fields) ? FIELDS.find((f) => fields.includes(f)) : undefined
    if (field) {
      const max = { prompt: PROMPT_MAX, options: MCQ_OPTIONS_MAX, guide: GUIDE_MAX, explanation: EXPLANATION_MAX, kind: 0 }[field]
      return <FieldError>{t(field, { max, min: MCQ_OPTIONS_MIN })}</FieldError>
    }
  }
  if (state.code === 'CONFLICT') {
    const reason = state.details?.reason
    if (typeof reason === 'string' && Object.hasOwn(CONFLICT_REASONS, reason)) {
      return <FieldError>{t(CONFLICT_REASONS[reason as keyof typeof CONFLICT_REASONS], { max: MAX_PRACTICE_PER_TOPIC })}</FieldError>
    }
  }
  return <ActionError state={state} />
}
