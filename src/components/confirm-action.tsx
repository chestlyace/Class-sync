'use client'

import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { ActionError } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { ActionResult } from '@/lib/action-result'

type FormAction = (prev: ActionResult<unknown> | null, data: FormData) => Promise<ActionResult<unknown>>

/** A button that opens a confirmation dialog, then submits `fields` to a Server Action. */
export function ConfirmAction({
  action,
  fields,
  triggerLabel,
  triggerAriaLabel,
  triggerIcon,
  title,
  body,
  note,
  confirmLabel,
  destructive = false,
}: {
  action: FormAction
  fields: Record<string, string>
  triggerLabel: string
  triggerAriaLabel?: string
  triggerIcon?: React.ReactNode
  title: string
  body: string
  note?: string
  confirmLabel: string
  destructive?: boolean
}) {
  const t = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [state, dispatch, pending] = useActionState(async (prev: ActionResult<unknown> | null, data: FormData) => {
    const result = await action(prev, data)
    if (result.ok) setOpen(false)
    return result
  }, null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={destructive ? 'destructive' : 'outline'}
          aria-label={triggerAriaLabel}
          title={triggerAriaLabel}
        >
          {triggerIcon}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </DialogHeader>
        <form action={dispatch} className="flex flex-col gap-3">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <ActionError state={state} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
