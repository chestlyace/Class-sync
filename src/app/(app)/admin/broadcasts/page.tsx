import { TriangleAlert } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import {
  audienceCounts,
  BROADCAST_AUDIENCES,
  BROADCAST_BODY_MAX,
  BROADCAST_SUBJECT_MAX,
  isBroadcastReady,
  listBroadcasts,
} from '@/server/broadcasts/service'
import { getFormatters } from '../format'
import { loadAdminPage } from '../load-admin'
import { adminMetadata } from '../metadata'
import { AutoRefresh } from './auto-refresh'
import { BroadcastForm } from './broadcast-form'

export async function generateMetadata() {
  return adminMetadata('broadcasts')
}

const LIMITS = { subjectMax: BROADCAST_SUBJECT_MAX, messageMax: BROADCAST_BODY_MAX }

export default async function AdminBroadcastsPage() {
  const [tAdmin, t, f] = await Promise.all([getTranslations('admin'), getTranslations('admin.broadcasts'), getFormatters()])
  const result = await loadAdminPage(async (ctx) => {
    const [counts, rows] = await Promise.all([audienceCounts(ctx), listBroadcasts(ctx)])
    return { counts, rows }
  })
  if (!result.ok) return <ErrorState code={result.code} />
  const { counts, rows } = result.data
  const ready = isBroadcastReady()

  return (
    <>
      <PageHeader eyebrow={tAdmin('title')} title={t('title')} description={t('description')} />

      {!ready && (
        <Panel className="flex items-start gap-3">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm">{t('notReady')}</p>
        </Panel>
      )}

      <BroadcastForm audiences={BROADCAST_AUDIENCES} counts={counts} ready={ready} limits={LIMITS} />

      <section aria-labelledby="history" className="flex flex-col gap-4">
        <SectionHeading id="history">{t('history.title')}</SectionHeading>
        {rows.length === 0 ? (
          <Panel>
            <p className="text-muted-foreground">{t('history.empty')}</p>
          </Panel>
        ) : (
          <Panel className="p-0 sm:p-0">
            <ul className="flex flex-col divide-y">
              {rows.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/admin/broadcasts/${encodeURIComponent(b.id)}`}
                    className="flex flex-col gap-1 px-5 py-4 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 sm:flex-row sm:items-center sm:gap-4 sm:px-7"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-semibold wrap-anywhere">{b.subjectEn}</span>
                      <span className="text-sm text-muted-foreground wrap-anywhere">
                        {t('history.meta', { admin: b.adminName, audience: t(`form.audiences.${b.audience}`) })}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col gap-0.5 text-[13px] text-muted-foreground sm:items-end sm:text-right">
                      <span className="font-medium text-foreground">
                        {b.status === 'sending'
                          ? t('history.sending', { done: b.sent + b.failed + b.skipped, total: b.total })
                          : t('history.done', { sent: b.sent, failed: b.failed, skipped: b.skipped })}
                      </span>
                      <span>{f.dateTime(b.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      <AutoRefresh active={rows.some((b) => b.status === 'sending')} />
    </>
  )
}
