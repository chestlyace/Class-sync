'use client'

import { Check, CircleHelp, Play } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import type { Role } from '@/server/core/context'
import { guidesFor } from './guides'
import { readSeen, requestGuide } from './guide-storage'

/** "?" in the nav: every guide for the user's role, to start (again) at any time; GuideRunner runs it. */
export function HelpButton({ role, userId }: { role: Role; userId: string }) {
  const t = useTranslations('guides')
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  const guides = guidesFor(role)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Seen guides are ticked: read when opening, since a guide may have ended since.
        if (next) setSeen(readSeen(userId))
        setOpen(next)
      }}
    >
      <DialogTrigger
        data-tour="help"
        title={t('common.help')}
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CircleHelp aria-hidden="true" className="size-5" />
        <span className="sr-only">{t('common.help')}</span>
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('common.helpTitle')}</DialogTitle>
          <DialogDescription>{t('common.helpDescription')}</DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 flex max-h-[60vh] flex-col overflow-y-auto">
          {guides.map((guide) => {
            const done = seen.has(guide.id)
            return (
              <li key={guide.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    requestGuide(guide.id)
                  }}
                  className="flex w-full items-start gap-3 rounded-2xl px-2 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground"
                  >
                    {done ? <Check className="size-4" /> : <Play className="size-4" />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{t(`items.${guide.id}.title`)}</span>
                    <span className="text-sm text-muted-foreground">{t(`items.${guide.id}.description`)}</span>
                    {done && <span className="sr-only">{t('common.seen')}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
