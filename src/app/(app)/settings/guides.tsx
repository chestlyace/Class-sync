'use client'

import { Check, Play } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { guidesFor } from '@/components/guides/guides'
import { requestGuide } from '@/components/guides/guide-storage'
import type { Role } from '@/server/core/context'

/**
 * Settings → Guides: every guide of my role, ticked once I have finished or closed it, each one
 * started (again) from here. GuideRunner, in the layout, takes me to the page where it begins.
 */
export function GuidesSettings({ role, seen }: { role: Role; seen: string[] }) {
  const t = useTranslations('guides')
  const done = new Set(seen)
  return (
    <ul data-tour="guides-list" className="-my-2 flex flex-col divide-y">
      {guidesFor(role).map((guide) => {
        const isDone = done.has(guide.id)
        return (
          <li key={guide.id}>
            <button
              type="button"
              onClick={() => requestGuide(guide.id)}
              className="flex w-full items-start gap-3 rounded-2xl px-1 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground"
              >
                {isDone ? <Check className="size-4" /> : <Play className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{t(`items.${guide.id}.title`)}</span>
                <span className="text-sm text-muted-foreground">{t(`items.${guide.id}.description`)}</span>
                {isDone && <span className="sr-only">{t('common.seen')}</span>}
              </span>
              <span className="shrink-0 self-center text-sm font-medium text-primary">
                {isDone ? t('common.replay') : t('common.start')}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
