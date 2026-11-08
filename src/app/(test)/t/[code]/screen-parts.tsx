'use client'

import { CloudCheck, CloudOff, CloudUpload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'signed_out' | 'failed'

/** Where the answers stand: text with a Lucide icon, never a coloured dot. Read out politely. */
export function SyncLine({ status, className }: { status: SyncStatus; className?: string }) {
  const t = useTranslations('tests.student.sync')
  const Icon = status === 'saved' ? CloudCheck : status === 'saving' ? CloudUpload : CloudOff
  const label = {
    saved: t('saved'),
    saving: t('saving'),
    offline: t('offline'),
    signed_out: t('signedOut'),
    failed: t('failed'),
  }[status]
  return (
    <p role="status" aria-live="polite" className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{label}</span>
    </p>
  )
}

/** A time span as "8 s" or "1 min 05 s". */
export function useFormatSpan(): (ms: number) => string {
  const t = useTranslations('tests.student.duration')
  return (ms: number) => {
    const total = Math.max(0, Math.round(ms / 1000))
    const m = Math.floor(total / 60)
    const s = total % 60
    return m === 0 ? t('seconds', { s }) : t('minutes', { m, s: String(s).padStart(2, '0') })
  }
}
