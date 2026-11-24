'use client'

import { Video } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { isInvalidField } from '@/components/action-error'
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { moveOnlineAction } from './actions'
import { ScheduleError } from './schedule-error'

/**
 * Moves one future in-person class online. The original date is cancelled and replaced by an online class at the
 * same time, so the lecturer keeps using the make-up flow they already know.
 */
export function MoveOnlineButton({ occurrenceKey, when }: { occurrenceKey: string; when: string }) {
  const t = useTranslations('schedule.classPage')
  const tMakeUp = useTranslations('schedule.makeUp')
  const tCommon = useTranslations('common')
  const [open, setOpen] = useState(false)
  const [state, dispatch, pending] = useActionState(
    async (_prev: ActionResult<never> | null, data: FormData) => moveOnlineAction(occurrenceKey, data),
    null,
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="lg" aria-label={`${t('moveOnline')} · ${when}`}>
          <Video aria-hidden="true" data-icon="inline-start" />
          {t('moveOnline')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tCommon('close')} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('moveOnlineTitle')}</DialogTitle>
          <DialogDescription>{t('moveOnlineBody', { when })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-4">
          <FieldGroup>
            <Field data-invalid={isInvalidField(state, 'meetingUrl') || undefined}>
              <FieldLabel htmlFor="move-online-url">{tMakeUp('meetingUrl')}</FieldLabel>
              <Input
                id="move-online-url"
                name="meetingUrl"
                type="url"
                inputMode="url"
                maxLength={2048}
                required
                placeholder={tMakeUp('meetingUrlPlaceholder')}
                aria-invalid={isInvalidField(state, 'meetingUrl') || undefined}
              />
              <FieldDescription>{t('meetingUrlHint')}</FieldDescription>
            </Field>
          </FieldGroup>
          <ScheduleError state={state} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" size="lg" variant="outline">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" size="lg" pending={pending}>
              {pending ? t('moving') : t('confirmMove')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
