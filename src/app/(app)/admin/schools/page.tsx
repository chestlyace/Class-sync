import { Search } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Form from 'next/form'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { SearchSubmit } from '@/components/search-submit'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { listSchools } from '@/server/admin/schools'
import { Pagination } from '../admin-ui'
import { getFormatters } from '../format'
import { loadAdminPage } from '../load-admin'
import { adminMetadata } from '../metadata'

export async function generateMetadata() {
  return adminMetadata('schools')
}

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function hrefFor(q: string, page: number): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/schools?${query}` : '/admin/schools'
}

export default async function AdminSchoolsPage({ searchParams }: PageProps<'/admin/schools'>) {
  const params = await searchParams
  const q = one(params.q).trim().slice(0, 200)
  const requested = Number.parseInt(one(params.page), 10)
  const [t, f] = await Promise.all([getTranslations('admin'), getFormatters()])
  const result = await loadAdminPage((ctx) =>
    listSchools(ctx, { search: q || undefined, page: Number.isFinite(requested) && requested >= 1 ? requested : 1 }),
  )
  if (!result.ok) return <ErrorState code={result.code} />
  const { rows, total, page, pageSize } = result.data

  return (
    <>
      <PageHeader eyebrow={t('title')} title={t('schools.title')} description={t('schools.description')} />

      <Panel>
        <Form action="/admin/schools" role="search" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="schools-q">{t('schools.search')}</Label>
            <Input
              id="schools-q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t('schools.searchPlaceholder')}
              maxLength={200}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-wrap gap-2.5">
            <SearchSubmit size="lg">
              <Search aria-hidden="true" data-icon="inline-start" />
              {t('schools.apply')}
            </SearchSubmit>
            {q && (
              <Link href="/admin/schools" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                {t('schools.clear')}
              </Link>
            )}
          </div>
        </Form>
      </Panel>

      {rows.length === 0 ? (
        <Panel>
          <p className="text-muted-foreground">{q ? t('schools.noMatch') : t('schools.empty')}</p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <Panel className="p-0 sm:p-0">
            <ul className="flex flex-col divide-y">
              {rows.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/schools/${encodeURIComponent(s.id)}`}
                    className="flex flex-col gap-1 px-5 py-4 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 sm:flex-row sm:items-center sm:gap-4 sm:px-7"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold wrap-anywhere">{s.name}</span>
                        {!s.hasLocation && <Badge variant="outline">{t('schools.noLocation')}</Badge>}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t('schools.counts', { classes: s.classes, lecturers: s.lecturers, students: s.students })}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col gap-0.5 text-[13px] text-muted-foreground sm:items-end sm:text-right">
                      <span className="font-mono text-[11px] font-semibold tracking-[0.1em] uppercase">{s.town}</span>
                      <span>{f.day(s.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Pagination page={page} pageSize={pageSize} total={total} href={(p) => hrefFor(q, p)} />
        </div>
      )}
    </>
  )
}
