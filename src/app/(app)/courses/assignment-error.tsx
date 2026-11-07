'use client'

import { useLocale, useTranslations } from 'next-intl'
import { ActionError } from '@/components/action-error'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import { formatDecimal } from '@/lib/number-format'
import { MAX_FILES } from '@/server/assignments/rules'

/** CONFLICT reasons the assignment and file services send. */
const CONFLICT_REASONS = {
  mode_locked: 'modeLocked',
  published: 'published',
  not_published: 'notPublished',
  closed: 'closed',
  too_many_pending: 'tooManyPending',
} as const

/** VALIDATION fields of the assignment form and the grade form. */
const FIELDS = {
  title: 'title',
  instructions: 'instructions',
  dueAt: 'dueAt',
  maxMark: 'maxMark',
  weight: 'weight',
  submissionMode: 'submissionMode',
  latePolicy: 'latePolicy',
  attachments: 'attachments',
  mark: 'mark',
  feedback: 'feedback',
} as const

/** VALIDATION reasons of the files service (attachments that can't be used). */
const FILE_REASONS = { type: 'fileType', size: 'fileSize', mismatch: 'fileMismatch', count: 'fileCount', files: 'files' } as const

type MessageKey =
  | (typeof CONFLICT_REASONS)[keyof typeof CONFLICT_REASONS]
  | (typeof FIELDS)[keyof typeof FIELDS]
  | (typeof FILE_REASONS)[keyof typeof FILE_REASONS]

function lookup<T extends Record<string, string>>(table: T, key: unknown): T[keyof T] | undefined {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key as keyof T] : undefined
}

/** The specific messages for a failed result, or [] when only the generic one applies. */
function messageKeys(state: Extract<ActionResult<unknown>, { ok: false }>): MessageKey[] {
  const reason = state.details?.reason
  if (state.code === 'CONFLICT') {
    const key = lookup(CONFLICT_REASONS, reason)
    return key ? [key] : []
  }
  if (state.code !== 'VALIDATION') return []
  const fileKey = lookup(FILE_REASONS, reason)
  if (fileKey) return [fileKey]
  const fields = Array.isArray(state.details?.fields) ? state.details.fields : []
  return fields.flatMap((f) => {
    const key = lookup(FIELDS, f)
    return key ? [key] : []
  })
}

/**
 * A failed assignment action, explained: each invalid field or the conflict's reason gets its own
 * sentence; anything else falls back to the generic error message.
 */
export function AssignmentError({ state, maxMark }: { state: ActionResult<unknown> | null; maxMark?: number }) {
  const t = useTranslations('assignments.lecturer.errors')
  const locale = useLocale()
  if (!state || state.ok) return null
  const values = { max: MAX_FILES, maxMark: formatDecimal(maxMark ?? 0, locale) }
  const keys = messageKeys(state)
  if (keys.length === 0) return <ActionError state={state} />
  return (
    <FieldError>
      {keys.length === 1 ? (
        t(keys[0], values)
      ) : (
        <ul className="ml-4 flex list-disc flex-col gap-1">
          {keys.map((key) => (
            <li key={key}>{t(key, values)}</li>
          ))}
        </ul>
      )}
    </FieldError>
  )
}
