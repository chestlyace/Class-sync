import { getTranslations } from 'next-intl/server'
import { SectionHeading } from '@/components/page-header'
import type { Locale } from '@/i18n/locale'
import { cn } from '@/lib/utils'
import { config } from '@/server/core/config'
import type { WeekRow } from '@/server/schedule/views'
import { RowBadge } from '../schedule/row-badge'
import { formatDay, formatTime } from '../schedule/schedule-format'

/** Student dashboard: this week's classes across their courses. Nothing at all when there are none. */
export async function ThisWeek({ rows, locale, today }: { rows: WeekRow[]; locale: Locale; today: string }) {
  if (rows.length === 0) return null
  const t = await getTranslations('dashboard')
  const tSchedule = await getTranslations('schedule')
  return (
    <section aria-labelledby="this-week" className="flex flex-col gap-4">
      <SectionHeading id="this-week">{t('thisWeek')}</SectionHeading>
      <ul className="flex flex-col divide-y rounded-3xl border">
        {rows.map((row) => {
          const { occurrence: occ } = row
          const cancelled = row.badge === 'cancelled'
          return (
            <li key={occ.key} className="flex flex-col gap-1.5 px-4 py-3.5 sm:flex-row sm:gap-6 sm:px-5">
              <span
                className={cn(
                  'flex shrink-0 items-baseline gap-3 font-mono text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase sm:w-44',
                  occ.date === today && 'text-primary',
                )}
              >
                <time dateTime={occ.date}>{formatDay(occ.date, locale, 'short')}</time>
                <time dateTime={occ.startsAt.toISOString()} className="text-sm tracking-normal tabular-nums">
                  {formatTime(occ.startsAt, config.timeZone)}
                </time>
              </span>
              <div className={cn('flex min-w-0 flex-col gap-0.5', cancelled && 'text-muted-foreground')}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{row.courseTitle}</span>
                  {row.badge && <RowBadge badge={row.badge} replacesDate={row.replacesDate} locale={locale} />}
                </div>
                {occ.room && (
                  <span className="text-sm text-muted-foreground">{tSchedule('room', { room: occ.room })}</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
