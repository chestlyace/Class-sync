import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import type { Locale } from '@/i18n/locale'
import type { WeekRow } from '@/server/schedule/views'
import { formatDay } from './schedule-format'

/** The text badge on a class row: Cancelled, Missed or Make-up (with the date it replaces, when known). */
export async function RowBadge({
  badge,
  replacesDate,
  locale,
}: {
  badge: NonNullable<WeekRow['badge']>
  replacesDate: string | null
  locale: Locale
}) {
  const t = await getTranslations('schedule.badge')
  if (badge === 'cancelled') return <Badge variant="destructive">{t('cancelled')}</Badge>
  if (badge === 'missed') return <Badge variant="secondary">{t('missed')}</Badge>
  return (
    <Badge variant="outline">
      {replacesDate ? t('makeUpFor', { date: formatDay(replacesDate, locale, 'short') }) : t('makeUp')}
    </Badge>
  )
}
