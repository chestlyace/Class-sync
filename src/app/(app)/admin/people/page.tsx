import { Search } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { listPeople, type PeopleQuery } from '@/server/admin/queries'
import type { Role } from '@/server/core/context'
import { Pagination } from '../admin-ui'
import { getFormatters } from '../format'
import { loadAdminPage } from '../load-admin'
import { adminMetadata } from '../metadata'

export async function generateMetadata() {
  return adminMetadata('people')
}

type Params = { [key: string]: string | string[] | undefined }

/** The filters as they appear in the URL (only known values survive). */
type Filters = { q: string; role: Role | ''; verified: 'yes' | 'no' | ''; suspended: 'yes' | 'no' | ''; page: number }

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function yesNo(value: string): 'yes' | 'no' | '' {
  return value === 'yes' || value === 'no' ? value : ''
}

function parseFilters(params: Params): Filters {
  const role = one(params.role)
  const page = Number.parseInt(one(params.page), 10)
  return {
    q: one(params.q).trim().slice(0, 200),
    role: role === 'lecturer' || role === 'student' ? role : '',
    verified: yesNo(one(params.verified)),
    suspended: yesNo(one(params.suspended)),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  }
}

function toQuery(f: Filters): PeopleQuery {
  return {
    search: f.q || undefined,
    role: f.role || undefined,
    verified: f.verified === '' ? undefined : f.verified === 'yes',
    suspended: f.suspended === '' ? undefined : f.suspended === 'yes',
    page: f.page,
  }
}

function hrefFor(f: Filters, page: number): string {
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.role) params.set('role', f.role)
  if (f.verified) params.set('verified', f.verified)
  if (f.suspended) params.set('suspended', f.suspended)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin/people?${query}` : '/admin/people'
}

export default async function AdminPeoplePage({ searchParams }: PageProps<'/admin/people'>) {
  const filters = parseFilters(await searchParams)
  const [t, f] = await Promise.all([getTranslations('admin'), getFormatters()])
  const result = await loadAdminPage((ctx) => listPeople(ctx, toQuery(filters)))
  if (!result.ok) return <ErrorState code={result.code} />
  const { rows, total, page, pageSize } = result.data
  const filtered = filters.q !== '' || filters.role !== '' || filters.verified !== '' || filters.suspended !== ''

  return (
    <>
      <PageHeader eyebrow={t('title')} title={t('people.title')} description={t('people.description')} />

      <Panel>
        <form action="/admin/people" method="get" role="search" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="people-q">{t('people.search')}</Label>
            <Input
              id="people-q"
              name="q"
              type="search"
              defaultValue={filters.q}
              placeholder={t('people.searchPlaceholder')}
              maxLength={200}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="people-role">{t('people.role.label')}</Label>
              <NativeSelect id="people-role" name="role" defaultValue={filters.role}>
                <option value="">{t('people.role.any')}</option>
                <option value="lecturer">{t('people.role.lecturer')}</option>
                <option value="student">{t('people.role.student')}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="people-verified">{t('people.verified.label')}</Label>
              <NativeSelect id="people-verified" name="verified" defaultValue={filters.verified}>
                <option value="">{t('people.verified.any')}</option>
                <option value="yes">{t('people.verified.yes')}</option>
                <option value="no">{t('people.verified.no')}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="people-suspended">{t('people.suspended.label')}</Label>
              <NativeSelect id="people-suspended" name="suspended" defaultValue={filters.suspended}>
                <option value="">{t('people.suspended.any')}</option>
                <option value="yes">{t('people.suspended.yes')}</option>
                <option value="no">{t('people.suspended.no')}</option>
              </NativeSelect>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button type="submit" size="lg">
              <Search aria-hidden="true" data-icon="inline-start" />
              {t('people.apply')}
            </Button>
            {filtered && (
              <Link href="/admin/people" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                {t('people.clear')}
              </Link>
            )}
          </div>
        </form>
      </Panel>

      {rows.length === 0 ? (
        <Panel>
          <p className="text-muted-foreground">{t('people.empty')}</p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <Panel className="p-0 sm:p-0">
            <ul className="flex flex-col divide-y">
              {rows.map((person) => (
                <li key={person.id}>
                  <Link
                    href={`/admin/people/${encodeURIComponent(person.id)}`}
                    className="flex flex-col gap-1 px-5 py-4 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 sm:flex-row sm:items-center sm:gap-4 sm:px-7"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold break-words">{person.name}</span>
                        {person.isAdmin && <Badge variant="outline">{t('badges.admin')}</Badge>}
                        {!person.emailVerified && <Badge variant="outline">{t('badges.unverified')}</Badge>}
                        {person.suspendedAt && <Badge variant="outline">{t('badges.suspended')}</Badge>}
                      </span>
                      <span className="text-sm break-all text-[#48484a]">{person.email}</span>
                    </span>
                    <span className="flex shrink-0 flex-col gap-0.5 text-[13px] text-muted-foreground sm:items-end sm:text-right">
                      <span className="font-mono text-[11px] font-semibold tracking-[0.1em] uppercase">
                        {t(`roles.${person.role}`)}
                      </span>
                      <span>{t('people.joined', { date: f.day(person.createdAt) })}</span>
                      <span>
                        {person.lastSignInAt
                          ? t('people.lastSignIn', { date: f.day(person.lastSignInAt) })
                          : t('people.neverSignedIn')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Pagination page={page} pageSize={pageSize} total={total} href={(p) => hrefFor(filters, p)} />
        </div>
      )}
    </>
  )
}
