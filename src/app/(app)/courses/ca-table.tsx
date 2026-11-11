'use client'

import { ArrowDown, Scaling, TrendingDown } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDecimal } from '@/lib/number-format'
import type { ComponentKey, ComponentScore } from '@/server/performance/compute'
import type { StudentCa } from '@/server/performance/service'

type SortKey = 'rank' | 'name'

/** "—" for a component that hasn't started, with its meaning for hover and screen readers. */
function NotStarted({ label }: { label: string }) {
  return (
    <span title={label}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** A part's score, "—" when the class hasn't started it, "N/A" when it doesn't apply to the student. */
function PartCell({ part, fmt }: { part: ComponentScore; fmt: (n: number) => string }) {
  const t = useTranslations('performance.lecturer.table')
  if (part.status === 'not_applicable') {
    return (
      <span title={t('notApplicableLabel')} className="text-muted-foreground">
        <span aria-hidden="true">{t('notApplicable')}</span>
        <span className="sr-only">{t('notApplicableLabel')}</span>
      </span>
    )
  }
  if (part.score === null) return <NotStarted label={t('notStarted')} />
  return <>{fmt(part.score)}</>
}

/** Beside a final that was scaled because some parts don't apply to the student. */
function ScaledBadge({ notAssessed, total }: { notAssessed: boolean; total: string }) {
  const t = useTranslations('performance.lecturer.table')
  const hint = notAssessed ? t('notAssessedHint') : t('scaledHint', { total })
  return (
    <Badge variant="outline" title={hint}>
      <Scaling aria-hidden="true" data-icon="inline-start" />
      <span>{notAssessed ? t('notAssessed') : t('scaled')}</span>
      <span className="sr-only">: {hint}</span>
    </Badge>
  )
}

/** A sortable column header: a button inside the `th`, which carries `aria-sort` when active. */
function SortHeader({
  sortKey,
  active,
  onSort,
  label,
  className,
}: {
  sortKey: SortKey
  active: SortKey
  onSort: (key: SortKey) => void
  label: string
  className?: string
}) {
  const t = useTranslations('performance.lecturer.table')
  const isActive = sortKey === active
  return (
    <TableHead scope="col" aria-sort={isActive ? 'ascending' : undefined} className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={t('sortBy', { column: label })}
        className="inline-flex min-h-9 items-center gap-1 rounded-full font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {label}
        <ArrowDown
          aria-hidden="true"
          className={isActive ? 'size-3.5 text-foreground' : 'size-3.5 text-muted-foreground/40'}
        />
      </button>
    </TableHead>
  )
}

/**
 * The class ranked by CA (ties share a rank). Sorting by rank or name happens here, on the rows
 * the server already ranked. Components worth 0 points are left out. A final scaled over parts
 * that don't apply to the student carries a "Scaled" badge. Scrolls inside its own
 * container, so the page never scrolls sideways on a phone.
 */
export function CaTable({ courseId, rows }: { courseId: string; rows: StudentCa[] }) {
  const t = useTranslations('performance.lecturer.table')
  const tComponent = useTranslations('performance.lecturer.component')
  const locale = useLocale()
  const [sort, setSort] = useState<SortKey>('rank')
  const fmt = (n: number) => formatDecimal(n, locale)

  // Every row carries the same configured components (0-point ones already omitted).
  const components: { key: ComponentKey; points: number }[] = rows[0]?.result.components ?? []
  const total = rows[0]?.result.total ?? 0
  const sorted = useMemo(
    () =>
      sort === 'rank'
        ? rows
        : [...rows].sort((a, b) => a.name.localeCompare(b.name, locale) || (a.matricule ?? '').localeCompare(b.matricule ?? '')),
    [rows, sort, locale],
  )
  const assignmentsHref = `/courses/${encodeURIComponent(courseId)}/assignments`

  return (
    <div className="overflow-hidden rounded-3xl border">
      <Table>
        <TableCaption className="sr-only">{t('caption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <SortHeader sortKey="rank" active={sort} onSort={setSort} label={t('rank')} className="px-4" />
            <SortHeader
              sortKey="name"
              active={sort}
              onSort={setSort}
              label={t('student')}
              className="sticky left-0 z-10 bg-card"
            />
            {components.map((c) => (
              <TableHead key={c.key} scope="col" className="text-right">
                {tComponent(c.key)}
                <span className="block font-mono text-xs font-normal text-muted-foreground">
                  {t('outOf', { points: fmt(c.points) })}
                </span>
              </TableHead>
            ))}
            <TableHead scope="col" className="text-right">
              {t('soFar')}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('final')}
              <span className="block font-mono text-xs font-normal text-muted-foreground">
                {t('outOf', { points: fmt(total) })}
              </span>
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('missing')}
            </TableHead>
            <TableHead scope="col">
              <span className="sr-only">{t('flag')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.studentId}>
              <TableCell className="px-4 font-mono">{row.rank}</TableCell>
              <TableHead scope="row" className="sticky left-0 z-10 bg-card font-normal">
                <span className="flex flex-col">
                  <span className="max-w-40 truncate font-medium sm:max-w-56">{row.name}</span>
                  {row.matricule && (
                    <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">{row.matricule}</span>
                  )}
                </span>
              </TableHead>
              {row.result.components.map((c) => (
                <TableCell key={c.key} data-testid={`ca-part-${c.key}-${row.studentId}`} className="text-right font-mono">
                  <PartCell part={c} fmt={fmt} />
                </TableCell>
              ))}
              <TableCell className="text-right font-mono">
                {row.result.soFarOutOf === 0 ? (
                  <NotStarted label={t('notStarted')} />
                ) : (
                  <>
                    {fmt(row.result.soFar)}
                    <span className="text-muted-foreground"> / {fmt(row.result.soFarOutOf)}</span>
                  </>
                )}
              </TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center justify-end gap-2">
                  {row.result.scaled && <ScaledBadge notAssessed={row.result.notAssessed} total={fmt(total)} />}
                  <span
                    data-testid={`ca-final-${row.studentId}`}
                    className="font-display text-2xl leading-none tracking-[0.02em]"
                  >
                    {fmt(row.result.final)}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-right font-mono">
                {row.missingWork > 0 ? (
                  <Link
                    href={assignmentsHref}
                    aria-label={t('missingLabel', { count: row.missingWork, name: row.name })}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {row.missingWork}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell>
                {row.slipping && (
                  <Badge variant="destructive" title={t('slippingHint')}>
                    <TrendingDown aria-hidden="true" data-icon="inline-start" />
                    {t('slipping')}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
