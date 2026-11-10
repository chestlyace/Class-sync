import { ExternalLink, TriangleAlert } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getHealth } from '@/server/admin/queries'
import { now } from '@/server/core/clock'
import { Card, FactList, Stat, StatGrid } from '../admin-ui'
import { getFormatters } from '../format'
import { loadAdminPage } from '../load-admin'
import { adminMetadata } from '../metadata'

export async function generateMetadata() {
  return adminMetadata('health')
}

const VERCEL_LOGS = 'https://vercel.com/developer-aces-projects/clasync/logs'

export default async function AdminHealthPage() {
  const [t, f] = await Promise.all([getTranslations('admin'), getFormatters()])
  const result = await loadAdminPage((ctx) => getHealth(ctx, now()))
  if (!result.ok) return <ErrorState code={result.code} />
  const { cron, email, files, env } = result.data

  return (
    <>
      <PageHeader eyebrow={t('title')} title={t('health.title')} description={t('health.description')} />

      <section aria-labelledby="cron" className="flex flex-col gap-4">
        <SectionHeading id="cron">{t('health.cron.title')}</SectionHeading>
        <Panel className="flex flex-col gap-4">
          {!cron.runsHere && <p className="text-muted-foreground">{t('health.cron.notHere')}</p>}
          {cron.stale && (
            <p role="status" className="flex items-start gap-2 font-medium">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              {t('health.cron.stale')}
            </p>
          )}
          {cron.lastRunAt ? (
            <FactList
              facts={[
                { label: t('health.cron.lastRun'), value: f.dateTime(cron.lastRunAt) },
                { label: t('health.cron.result'), value: cron.ok ? t('health.cron.ok') : t('health.cron.failed') },
                ...(cron.assignments !== undefined
                  ? [{ label: t('health.cron.assignments'), value: f.number(cron.assignments) }]
                  : []),
                ...(cron.reminded !== undefined ? [{ label: t('health.cron.reminded'), value: f.number(cron.reminded) }] : []),
              ]}
            />
          ) : (
            <p className="text-muted-foreground">{t('health.cron.never')}</p>
          )}
        </Panel>
      </section>

      <section aria-labelledby="email" className="flex flex-col gap-4">
        <SectionHeading id="email">{t('health.email.title')}</SectionHeading>
        <StatGrid className="sm:grid-cols-2 lg:grid-cols-2">
          <Stat label={t('health.email.sent')} value={f.number(email.sent7d)} />
          <Stat label={t('health.email.failed')} value={f.number(email.failed7d)} />
        </StatGrid>
        <Card title={t('health.email.recent')}>
          {email.recentFailures.length === 0 ? (
            <p className="text-muted-foreground">{t('health.email.none')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {email.recentFailures.map((failure, i) => (
                <li key={`${failure.at.toISOString()}-${i}`} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                  <span className="flex flex-wrap gap-x-2 text-[13px] text-muted-foreground">
                    <span>{f.dateTime(failure.at)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">
                      {failure.kind === 'batch' ? t('health.email.batch') : (failure.kind ?? t('health.email.unknownKind'))}
                    </span>
                    {failure.to && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="break-all">{failure.to}</span>
                      </>
                    )}
                  </span>
                  <span className="text-sm break-words">{failure.error || t('health.email.noError')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-labelledby="files" className="flex flex-col gap-4">
        <SectionHeading id="files">{t('health.files.title')}</SectionHeading>
        <StatGrid className="sm:grid-cols-2 lg:grid-cols-2">
          <Stat label={t('health.files.count')} value={f.number(files.count)} />
          <Stat label={t('health.files.size')} value={f.bytes(files.bytes)} />
        </StatGrid>
      </section>

      <section aria-labelledby="env" className="flex flex-col gap-4">
        <SectionHeading id="env">{t('health.env.title')}</SectionHeading>
        <Panel>
          <FactList
            facts={[
              { label: t('health.env.name'), value: <span className="font-mono">{env.name}</span> },
              {
                label: t('health.env.commit'),
                value: env.commit ? <span className="font-mono">{env.commit}</span> : t('health.env.noCommit'),
              },
              {
                label: t('health.env.migrations'),
                value: env.migrations === null ? t('health.env.unknownMigrations') : f.number(env.migrations),
              },
            ]}
          />
        </Panel>
      </section>

      <section aria-labelledby="logs" className="flex flex-col gap-4">
        <SectionHeading id="logs">{t('health.logs.title')}</SectionHeading>
        <Panel className="flex flex-col items-start gap-4">
          <p className="text-muted-foreground">{t('health.logs.hint')}</p>
          <a href={VERCEL_LOGS} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
            {t('health.logs.link')}
            <ExternalLink aria-hidden="true" data-icon="inline-end" />
          </a>
        </Panel>
      </section>
    </>
  )
}
