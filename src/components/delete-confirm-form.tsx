'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useId, useState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'

function matches(typed: string, expected: string): boolean {
  // Same comparison as the server (requireConfirmation): case and outer spaces don't matter.
  return typed.trim().toLowerCase() === expected.trim().toLowerCase()
}

/**
 * The last step of a destructive action: the button only wakes up once the name is typed. The
 * server checks the name again, so a stale or crafted form deletes nothing.
 */
export function DeleteConfirmForm({
  action,
  hidden,
  confirmText,
  label,
  buttonLabel,
  pendingLabel,
}: {
  action: (prev: ActionResult<never> | null, data: FormData) => Promise<ActionResult<never>>
  hidden: Record<string, string>
  confirmText: string
  label: string
  buttonLabel: string
  pendingLabel: string
}) {
  const [state, dispatch, pending] = useActionState(action, null)
  const [typed, setTyped] = useState('')
  const id = useId()
  const ready = matches(typed, confirmText)

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field data-invalid={isInvalidField(state, 'confirm') || undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          name="confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={isInvalidField(state, 'confirm') || undefined}
        />
      </Field>
      <ActionError state={state} />
      <Button type="submit" variant="destructive" disabled={!ready || pending} className="self-start">
        <Trash2 aria-hidden="true" data-icon="inline-start" />
        {pending ? pendingLabel : buttonLabel}
      </Button>
    </form>
  )
}
