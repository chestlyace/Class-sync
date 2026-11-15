import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { listAudit, type AuditTarget } from '@/server/admin/queries'
import { Pagination } from '../admin-ui'
import { getFormatters } from '../format'
import { loadAdminPage } from '../load-admin'
import { adminMetadata } from '../metadata'

export async function generateMetadata() {
  return adminMetadata('audit')
}

type AdminT = Awaited<ReturnType<typeof getTranslations<'admin'>>>
type AdminActionDetails = Extract<AuditTarget, { kind: 'school' }>['details']

/** What a school action changed, from the names kept in the row (the school may be gone). */
function schoolText(details: AdminActionDetails, t: AdminT): string {
  switch (details.kind) {
    case 'school_update':
      return t('audit.school.update', { before: details.before.name, after: details.after.name, town: details.after.town })
    case 'school_delete':
      return t('audit.school.delete', { name: details.school.name, town: details.school.town, classes: details.classes })
    case 'school_merge':
      return t('audit.school.merge', { from: details.from.name, into: details.into.name })
  }
}

/** Links to the school while it still exists; a deleted school is plain text. */
function SchoolTarget({ schoolId, exists, text }: { schoolId: string; exists: boolean; text: string }) {
  if (!exists) return <>{text}</>
  return (
    <Link href={`/admin/schools/${encodeURIComponent(schoolId)}`} className="underline-offset-4 hover:underline">
      {text}
    </Link>
  )
}

function pageParam(value: string | string[] | undefined): number {
  const page = Number.parseInt(typeof value === 'string' ? value : '', 10)
  return Number.isFinite(page) && page >= 1 ? page : 1
}

export default async function AdminAuditPage({ searchParams }: PageProps<'/admin/audit'>) {
  const requested = pageParam((await searchParams).page)
  const [t, f] = await Promise.all([getTranslations('admin'), getFormatters()])
  const result = await loadAdminPage((ctx) => listAudit(ctx, requested))
  if (!result.ok) return <ErrorState code={result.code} />
  const { rows, total, page, pageSize } = result.data

  return (
    <>
      <PageHeader eyebrow={t('title')} title={t('audit.title')} description={t('audit.description')} />
      {rows.length === 0 ? (
        <Panel>
          <p className="text-muted-foreground">{t('audit.empty')}</p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <Panel>
            <ol className="flex flex-col divide-y">
              {rows.map((row, i) => (
                <li key={`${row.at.toISOString()}-${i}`} className="flex flex-col gap-1 py-3.5 first:pt-0 last:pb-0">
                  <span className="text-[13px] text-muted-foreground">
                    <time dateTime={row.at.toISOString()}>{f.dateTime(row.at)}</time>
                    {' · '}
                    {t('audit.by', { name: row.adminName })}
                  </span>
                  <span className="break-words">
                    <span className="font-semibold">{t(`audit.actions.${row.action}`)}</span>
                    {' · '}
                    {row.target.kind === 'user' ? (
                      <>
                        {row.target.name} <span className="break-all text-muted-foreground">({row.target.email})</span>
                      </>
                    ) : (
                      <SchoolTarget
                        schoolId={row.target.schoolId}
                        exists={row.target.exists}
                        text={schoolText(row.target.details, t)}
                      />
                    )}
                  </span>
                  <span className="text-sm break-words text-[#48484a]">{row.reason ?? t('audit.noReason')}</span>
                </li>
              ))}
            </ol>
          </Panel>
          <Pagination page={page} pageSize={pageSize} total={total} href={(p) => (p > 1 ? `/admin/audit?page=${p}` : '/admin/audit')} />
        </div>
      )}
    </>
  )
}
