import { Video } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { config } from '@/server/core/config'
import { JOIN_LEAD_MS } from '@/server/schedule/queries'
import { formatTime } from './schedule-format'

/** The student's only route to a meeting URL. The label tells them when it becomes usable. */
export async function JoinClass({
  occurrenceKey,
  courseTitle,
  window,
  startsAt,
}: {
  occurrenceKey: string
  courseTitle: string
  window: 'open' | 'upcoming'
  startsAt: Date
}) {
  const t = await getTranslations('schedule.row')
  const label = `${t('joinLabel', { course: courseTitle })}`
  const href = `/schedule/class/${encodeURIComponent(occurrenceKey)}/join`
  if (window === 'upcoming') {
    const opensAt = formatTime(new Date(startsAt.getTime() - JOIN_LEAD_MS), config.timeZone)
    return (
      <span
        aria-disabled="true"
        title={t('opensAt', { time: opensAt })}
        className={buttonVariants({ variant: 'outline', size: 'sm', className: 'cursor-not-allowed opacity-60' })}
      >
        <Video aria-hidden="true" data-icon="inline-start" />
        {t('opensAt', { time: opensAt })}
      </span>
    )
  }
  return (
    <Link href={href} className={buttonVariants({ size: 'sm' })} aria-label={label}>
      <Video aria-hidden="true" data-icon="inline-start" />
      {t('join')}
    </Link>
  )
}
