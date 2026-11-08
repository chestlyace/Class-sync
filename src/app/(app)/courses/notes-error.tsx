'use client'

import { useTranslations } from 'next-intl'
import { ActionError } from '@/components/action-error'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'

/** CONFLICT reasons the notes services send. */
const CONFLICT_REASONS = { not_empty: 'notEmpty', already_there: 'alreadyThere' } as const

/** VALIDATION fields of the topic, item and share forms. */
const FIELDS = { title: 'title', body: 'body', file: 'file', url: 'url', topic: 'topic', course: 'course' } as const

type MessageKey = (typeof CONFLICT_REASONS)[keyof typeof CONFLICT_REASONS] | (typeof FIELDS)[keyof typeof FIELDS]

function lookup<T extends Record<string, string>>(table: T, key: unknown): T[keyof T] | undefined {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key as keyof T] : undefined
}

function messageKeys(state: Extract<ActionResult<unknown>, { ok: false }>): MessageKey[] {
  if (state.code === 'CONFLICT') {
    const key = lookup(CONFLICT_REASONS, state.details?.reason)
    return key ? [key] : []
  }
  if (state.code !== 'VALIDATION') return []
  const fields = Array.isArray(state.details?.fields) ? state.details.fields : []
  return fields.flatMap((f) => {
    const key = lookup(FIELDS, f)
    return key ? [key] : []
  })
}

/** A failed notes action, explained: each invalid field or the conflict's reason gets its own sentence. */
export function NotesError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('notes.errors')
  if (!state || state.ok) return null
  const keys = messageKeys(state)
  if (keys.length === 0) return <ActionError state={state} />
  return (
    <FieldError>
      {keys.length === 1 ? (
        t(keys[0])
      ) : (
        <ul className="ml-4 flex list-disc flex-col gap-1">
          {keys.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
    </FieldError>
  )
}
