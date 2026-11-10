import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** One figure with its label: a big number, quiet label. */
export function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-2xl border bg-card px-4 py-3.5', className)}>
      <span className="font-display text-4xl leading-none break-words">{value}</span>
      <span className="text-[13px] text-muted-foreground">{label}</span>
    </div>
  )
}

/** A responsive grid of <Stat>s: two across on a phone, more on wider screens. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', className)}>{children}</div>
}

export type Fact = { label: string; value: React.ReactNode }

/** Label/value rows: stacked on a phone, two columns from `sm`. */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="flex flex-col divide-y">
      {facts.map(({ label, value }) => (
        <div key={label} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm text-muted-foreground sm:w-44">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A titled panel for one block of a page. */
export function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Panel className={cn('flex min-w-0 flex-col gap-4', className)}>
      <h3 className="font-semibold">{title}</h3>
      {children}
    </Panel>
  )
}

/** "1–50 of 123" with Previous / Next links; nothing when everything fits on one page. */
export async function Pagination({
  page,
  pageSize,
  total,
  href,
}: {
  page: number
  pageSize: number
  total: number
  href: (page: number) => string
}) {
  const t = await getTranslations('admin.pagination')
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = Math.min(total, (page - 1) * pageSize + 1)
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label={t('label')} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{t('range', { from, to, total })}</p>
      {pages > 1 && (
        <div className="flex gap-2">
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev" className={buttonVariants({ variant: 'outline' })}>
              <ChevronLeft aria-hidden="true" data-icon="inline-start" />
              {t('previous')}
            </Link>
          ) : null}
          {page < pages ? (
            <Link href={href(page + 1)} rel="next" className={buttonVariants({ variant: 'outline' })}>
              {t('next')}
              <ChevronRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          ) : null}
        </div>
      )}
    </nav>
  )
}
