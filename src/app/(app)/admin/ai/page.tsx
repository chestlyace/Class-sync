import { ExternalLink } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { BarChart } from '@/components/bar-chart'
import { ErrorState } from '@/components/error-state'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getAiAndMcp } from '@/server/admin/queries'
import { now } from '@/server/core/clock'
import { Card, Stat, StatGrid } from '../admin-ui'
import { getFormatters } from '../format'
import { loadAdminPage } from '../load-admin'
import { adminMetadata } from '../metadata'

export async function generateMetadata() {
  return adminMetadata('ai')
}

/** The team's AI Gateway page in the Vercel dashboard. */
const AI_GATEWAY_DASHBOARD = 'https://vercel.com/developer-aces-projects/~/ai'

export default async function AdminAiPage() {
  const [t, f] = await Promise.all([getTranslations('admin'), getFormatters()])
  const result = await loadAdminPage((ctx) => getAiAndMcp(ctx, now()))
  if (!result.ok) return <ErrorState code={result.code} />
  const { credits, suggestions, mcp } = result.data
  const suggestionTotal = suggestions.reduce((n, p) => n + p.value, 0)

  return (
    <>
      <PageHeader eyebrow={t('title')} title={t('ai.title')} description={t('ai.description')} />

      <section aria-labelledby="credits" className="flex flex-col gap-4">
        <SectionHeading id="credits">{t('ai.credits.title')}</SectionHeading>
        {credits ? (
          <StatGrid className="sm:grid-cols-2 lg:grid-cols-2">
            <Stat label={t('ai.credits.balance')} value={credits.balance} />
            <Stat label={t('ai.credits.used')} value={credits.totalUsed} />
          </StatGrid>
        ) : (
          <Card title={t('ai.credits.unavailable')}>
            <p className="-mt-2 text-muted-foreground">{t('ai.credits.unavailableHint')}</p>
            <a
              href={AI_GATEWAY_DASHBOARD}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', className: 'w-fit' })}
            >
              {t('ai.credits.dashboard')}
              <ExternalLink aria-hidden="true" data-icon="inline-end" />
            </a>
          </Card>
        )}
      </section>

      <section aria-labelledby="suggestions" className="flex flex-col gap-4">
        <SectionHeading id="suggestions">{t('ai.suggestions.title')}</SectionHeading>
        <Card title={t('ai.suggestions.total', { count: f.number(suggestionTotal) })}>
          <BarChart
            title={t('ai.suggestions.chart')}
            dayLabel={t('chart.day')}
            locale={f.locale}
            series={[{ label: t('ai.suggestions.series'), points: suggestions }]}
          />
        </Card>
      </section>

      <section aria-labelledby="mcp" className="flex flex-col gap-4">
        <SectionHeading id="mcp">{t('ai.mcp.title')}</SectionHeading>
        <StatGrid className="lg:grid-cols-3">
          <Stat label={t('ai.mcp.lecturersConnected')} value={f.number(mcp.lecturersConnected)} />
          <Stat label={t('ai.mcp.oauthConnections')} value={f.number(mcp.oauthConnections)} />
          <Stat label={t('ai.mcp.personalTokens')} value={f.number(mcp.personalTokens)} />
          <Stat label={t('ai.mcp.requests7d')} value={f.number(mcp.requests7d)} />
          <Stat label={t('ai.mcp.rateLimited7d')} value={f.number(mcp.rateLimited7d)} />
        </StatGrid>
      </section>
    </>
  )
}
