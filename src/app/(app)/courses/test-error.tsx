'use client'

import { useTranslations } from 'next-intl'
import { ActionError } from '@/components/action-error'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'

/** VALIDATION reasons of `validateTestInput`; those with a question index name the question. */
const INPUT_REASONS = {
  shape: 'shape',
  title: 'title',
  duration: 'duration',
  mark: 'mark',
  leaving: 'leaving',
  questions: 'questions',
  prompt: 'prompt',
  options: 'options',
  correct: 'correct',
  guide: 'guide',
} as const

/** CONFLICT reasons of the test services. */
const CONFLICT_REASONS = {
  started: 'started',
  not_started: 'notStarted',
  not_ended: 'notEnded',
  test_over: 'testOver',
} as const

function lookup<T extends Record<string, string>>(table: T, key: unknown): T[keyof T] | undefined {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key as keyof T] : undefined
}

/**
 * A failed test action, explained: the service's reason gets its own sentence, pointing at the
 * question when there is one ("Question 3: tick exactly one correct answer"); anything else falls
 * back to the generic message.
 */
export function TestError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('tests.lecturer.errors')
  if (!state || state.ok) return null
  const reason = state.details?.reason
  if (state.code === 'CONFLICT') {
    const key = lookup(CONFLICT_REASONS, reason)
    if (key) return <FieldError>{t(key)}</FieldError>
  }
  if (state.code === 'VALIDATION') {
    const key = lookup(INPUT_REASONS, reason)
    const question = state.details?.question
    if (key && typeof question === 'number') {
      return <FieldError>{t('inQuestion', { n: question + 1, problem: t(`question.${key}`) })}</FieldError>
    }
    if (key) return <FieldError>{t(`test.${key}`)}</FieldError>
  }
  return <ActionError state={state} />
}
