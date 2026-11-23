import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { getBroadcast } from '@/server/broadcasts/service'
import { FactList } from '../../admin-ui'
import { getFormatters } from '../../format'
import { loadAdminPage } from '../../load-admin'
import { adminMetadata } from '../../metadata'
import { AutoRefresh } from '../auto-refresh'

export async function generateMetadata() {
  return adminMetadata('broadcasts')
}

/** Reason codes the job writes on skipped and failed rows; anything else is a scrubbed provider message. */
const REASON_CODES = new Set(['deleted', 'suspended', 'opted_out', 'not_allowed', 'interrupted'])

export default async function AdminBroadcastPage({ params }: PageProps<'/admin/broadcasts/[id]'>) {
  const { id } = await params
  const [t, f] = await Promise.all([getTranslations('admin.broadcasts'), getFormatters()])
  const result = await loadAdminPage((ctx) => getBroadcast(ctx, id))
  if (!result.ok) return <ErrorState code={result.code} />
  const detail = result.data
  const sending = detail.status === 'sending'
  const versions = [
    { id: 'en', label: t('form.versionEn'), subject: detail.subjectEn, message: detail.bodyEn },
    { id: 'fr', label: t('form.versionFr'), subject: detail.subjectFr, message: detail.bodyFr },
  ]
  const hidden = detail.failed + detail.skipped - detail.problems.length

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link
          href="/admin/broadcasts"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('detail.back')}
        </Link>
        <PageHeader eyebrow={t('detail.eyebrow')} title={detail.subjectEn} />
      </div>

      <section aria-labelledby="facts" className="flex flex-col gap-4">
        <SectionHeading id="facts">{t('detail.factsTitle')}</SectionHeading>
        <Panel>
          <FactList
            facts={[
              { label: t('detail.sentOn'), value: f.dateTime(detail.createdAt) },
              { label: t('detail.sentBy'), value: detail.adminName },
              { label: t('detail.audience'), value: t(`form.audiences.${detail.audience}`) },
              { label: t('detail.status'), value: sending ? t('detail.statusSending') : t('detail.statusDone') },
              { label: t('detail.recipients'), value: f.number(detail.total) },
              { label: t('detail.sent'), value: f.number(detail.sent) },
              { label: t('detail.failed'), value: f.number(detail.failed) },
              { label: t('detail.skipped'), value: f.number(detail.skipped) },
            ]}
          />
        </Panel>
      </section>

      <section aria-labelledby="versions" className="flex flex-col gap-4">
        <SectionHeading id="versions">{t('detail.versionsTitle')}</SectionHeading>
        <div className="grid gap-4 md:grid-cols-2">
          {versions.map((v) => (
            <Panel key={v.id} className="flex min-w-0 flex-col gap-4">
              <h3 className="font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">{v.label}</h3>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{t('detail.subject')}</span>
                <p className="font-semibold wrap-anywhere">{v.subject}</p>
              </div>
              <p className="whitespace-pre-wrap wrap-anywhere">{v.message}</p>
            </Panel>
          ))}
        </div>
      </section>

      <section aria-labelledby="problems" className="flex flex-col gap-4">
        <SectionHeading id="problems">{t('detail.problemsTitle')}</SectionHeading>
        <Panel>
          {detail.problems.length === 0 ? (
            <p className="text-muted-foreground">{t('detail.noProblems')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <ul className="flex flex-col divide-y">
                {detail.problems.map((p) => (
                  <li
                    key={`${p.status}:${p.email}`}
                    className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <span className="min-w-0 flex-1 font-mono text-[13px] break-all">{p.email}</span>
                    <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Badge variant={p.status === 'failed' ? 'destructive' : 'outline'}>
                        {p.status === 'failed' ? t('detail.problemFailed') : t('detail.problemSkipped')}
                      </Badge>
                      <span className="text-sm text-muted-foreground wrap-anywhere">
                        {p.error === null || p.error === ''
                          ? t('detail.noReason')
                          : REASON_CODES.has(p.error)
                            ? t(`detail.reasons.${p.error}`)
                            : p.error}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <p className="text-sm text-muted-foreground">{t('detail.problemsCapped', { count: detail.problems.length })}</p>
              )}
            </div>
          )}
        </Panel>
      </section>

      <AutoRefresh active={sending} />
    </>
  )
}
