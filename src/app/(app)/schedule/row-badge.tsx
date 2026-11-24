import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import type { Locale } from '@/i18n/locale'
import type { WeekRow } from '@/server/schedule/views'
import { formatDay } from './schedule-format'

/** The text badges on a class row: Cancelled, Missed, Make-up and Online. */
export async function RowBadge({
  badge,
  replacesDate,
  online,
  locale,
}: {
  badge: WeekRow['badge']
  replacesDate: string | null
  online: boolean
  locale: Locale
}) {
  const t = await getTranslations('schedule.badge')
  return (
    <>
      {badge === 'cancelled' && <Badge variant="destructive">{t('cancelled')}</Badge>}
      {badge === 'missed' && <Badge variant="secondary">{t('missed')}</Badge>}
      {badge === 'makeUp' && (
        <Badge variant="outline">
          {replacesDate ? t('makeUpFor', { date: formatDay(replacesDate, locale, 'short') }) : t('makeUp')}
        </Badge>
      )}
      {online && badge !== 'cancelled' && <Badge variant="outline">{t('online')}</Badge>}
    </>
  )
}
