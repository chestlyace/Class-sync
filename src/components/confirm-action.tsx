'use client'

import { TriangleAlert } from 'lucide-react'
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
  warning,
  confirmLabel,
  destructive = false,
  primary = false,
  renderError,
  open: openProp,
  onOpenChange,
  children,
}: {
  action: FormAction
  fields: Record<string, string>
  /** Not needed when `open` is given: the caller opens the dialog (e.g. from a menu item). */
  triggerLabel?: string
  triggerAriaLabel?: string
  triggerIcon?: React.ReactNode
  title: string
  body: string
  note?: string
  /** A consequence the person may not expect, shown more strongly than `note`. */
  warning?: string
  confirmLabel: string
  destructive?: boolean
  /** Shows the trigger as the page's main action (filled blue). */
  primary?: boolean
  /** Replaces the generic error message (e.g. to explain a service `reason`). */
  renderError?: (state: ActionResult<unknown> | null) => React.ReactNode
  /** Controls the dialog from outside; the trigger button is then not shown. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Extra form fields submitted with `fields` (e.g. an optional reason). */
  children?: React.ReactNode
}) {
  const t = useTranslations('common')
  const [innerOpen, setInnerOpen] = useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : innerOpen
  const setOpen = controlled ? (onOpenChange ?? (() => undefined)) : setInnerOpen
  const [state, dispatch, pending] = useActionState(async (prev: ActionResult<unknown> | null, data: FormData) => {
    const result = await action(prev, data)
    if (result.ok) setOpen(false)
    return result
  }, null)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button
            type="button"
            size="lg"
            variant={destructive ? 'destructive' : primary ? 'default' : 'outline'}
            aria-label={triggerAriaLabel}
            title={triggerAriaLabel}
          >
            {triggerIcon}
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
          {warning && (
            <p className="flex items-start gap-2 text-sm font-medium text-foreground">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              {warning}
            </p>
          )}
        </DialogHeader>
        <form action={dispatch} className="flex flex-col gap-3">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children}
          {renderError ? renderError(state) : <ActionError state={state} />}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" size="lg" variant="outline">
                {t('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" size="lg" variant={destructive ? 'destructive' : 'default'} disabled={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
