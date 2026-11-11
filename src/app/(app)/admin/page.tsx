import { Activity, ArrowRight, Bot, ChartColumn, type LucideIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { BarChart } from '@/components/bar-chart'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { getOverview } from '@/server/admin/queries'
import { now } from '@/server/core/clock'
import { Stat, StatGrid } from './admin-ui'
import { getFormatters } from './format'
import { loadAdminPage } from './load-admin'
import { adminMetadata } from './metadata'

export async function generateMetadata() {
  return adminMetadata('overview')
}

const sum = (points: { value: number }[]) => points.reduce((n, p) => n + p.value, 0)

export default async function AdminOverviewPage() {
  const [t, f] = await Promise.all([getTranslations('admin'), getFormatters()])
  const result = await loadAdminPage((ctx) => getOverview(ctx, now()))
  if (!result.ok) return <ErrorState code={result.code} />
  const { totals, signups, active } = result.data
  const n = f.number

  const links: { href: string; title: string; body: string; icon: LucideIcon }[] = [
    { href: '/admin/usage', title: t('nav.usage'), body: t('overview.links.usage'), icon: ChartColumn },
    { href: '/admin/ai', title: t('nav.ai'), body: t('overview.links.ai'), icon: Bot },
    { href: '/admin/health', title: t('nav.health'), body: t('overview.links.health'), icon: Activity },
  ]

  return (
    <>
      <PageHeader eyebrow={t('title')} title={t('overview.title')} description={t('overview.description')} />

      <section aria-labelledby="totals" className="flex flex-col gap-4">
        <SectionHeading id="totals">{t('overview.totals.title')}</SectionHeading>
        <StatGrid>
          <Stat label={t('overview.totals.lecturers')} value={n(totals.lecturers)} />
          <Stat label={t('overview.totals.students')} value={n(totals.students)} />
          <Stat label={t('overview.totals.schools')} value={n(totals.schools)} />
          <Stat label={t('overview.totals.classes')} value={n(totals.classes)} />
          <Stat label={t('overview.totals.courses')} value={n(totals.courses)} />
          <Stat label={t('overview.totals.unverified')} value={n(totals.unverified)} />
          <Stat label={t('overview.totals.suspended')} value={n(totals.suspended)} />
        </StatGrid>
      </section>

      <section aria-labelledby="signups" className="flex flex-col gap-4">
        <SectionHeading id="signups">{t('overview.signups.title')}</SectionHeading>
        <Panel className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {t('overview.signups.total', {
              lecturers: n(sum(signups.lecturers)),
              students: n(sum(signups.students)),
            })}
          </p>
          <BarChart
            title={t('overview.signups.chart')}
            dayLabel={t('chart.day')}
            locale={f.locale}
            series={[
              { label: t('overview.signups.lecturers'), points: signups.lecturers },
              { label: t('overview.signups.students'), points: signups.students },
            ]}
          />
        </Panel>
      </section>

      <section aria-labelledby="active" className="flex flex-col gap-4">
        <SectionHeading id="active">{t('overview.active.title')}</SectionHeading>
        <p className="-mt-1 text-sm text-muted-foreground">{t('overview.active.hint')}</p>
        <StatGrid className="sm:grid-cols-3 lg:grid-cols-3">
          <Stat label={t('overview.active.day1')} value={n(active.day1)} />
          <Stat label={t('overview.active.day7')} value={n(active.day7)} />
          <Stat label={t('overview.active.day30')} value={n(active.day30)} />
        </StatGrid>
      </section>

      <section aria-labelledby="more" className="flex flex-col gap-4">
        <SectionHeading id="more">{t('overview.links.title')}</SectionHeading>
        <ul className="grid gap-3 sm:grid-cols-3">
          {links.map(({ href, title, body, icon: Icon }) => (
            <li key={href} className="flex">
              <Link
                href={href}
                className="group flex flex-1 flex-col gap-2 rounded-2xl border bg-card p-5 outline-none transition-colors hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                <span className="flex items-center gap-1.5 font-semibold">
                  {title}
                  <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-sm text-muted-foreground">{body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
