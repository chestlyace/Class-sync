import { getTranslations } from 'next-intl/server'
import { BarChart } from '@/components/bar-chart'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { getUsage, USAGE_SERIES } from '@/server/admin/queries'
import { now } from '@/server/core/clock'
import { Card } from '../admin-ui'
import { getFormatters } from '../format'
import { loadAdminPage } from '../load-admin'
import { adminMetadata } from '../metadata'

export async function generateMetadata() {
  return adminMetadata('usage')
}

export default async function AdminUsagePage() {
  const [t, f] = await Promise.all([getTranslations('admin'), getFormatters()])
  const result = await loadAdminPage((ctx) => getUsage(ctx, now()))
  if (!result.ok) return <ErrorState code={result.code} />
  const usage = result.data

  return (
    <>
      <PageHeader eyebrow={t('title')} title={t('usage.title')} description={t('usage.description')} />
      <ul className="grid gap-4 md:grid-cols-2">
        {USAGE_SERIES.map((key) => {
          const label = t(`usage.series.${key}`)
          const points = usage[key]
          const total = points.reduce((n, p) => n + p.value, 0)
          return (
            <li key={key} className="flex min-w-0">
              <Card title={label} className="flex-1">
                <p className="-mt-3 text-sm text-muted-foreground">{t('usage.total', { count: f.number(total) })}</p>
                <BarChart
                  title={t('usage.chart', { label })}
                  dayLabel={t('chart.day')}
                  locale={f.locale}
                  series={[{ label, points }]}
                />
              </Card>
            </li>
          )
        })}
      </ul>
    </>
  )
}
