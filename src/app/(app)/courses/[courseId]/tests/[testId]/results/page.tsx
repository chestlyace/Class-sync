import { ArrowLeft } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { toActionResult } from '@/lib/action-result'
import { formatDecimal } from '@/lib/number-format'
import { AppError } from '@/server/core/errors'
import { getTestResults, type ResultRow } from '@/server/tests/run'
import type { TestSummary } from '@/server/tests/authoring'
import { loadPage } from '../../../../../load-page'
import { TestStatePill } from '../../../../test-state'

type ResultsView = { test: TestSummary; rows: ResultRow[]; pending: number } | { notEnded: true }

export async function generateMetadata() {
  const t = await getTranslations('tests.lecturer.results')
  return { title: t('title') }
}

export default async function TestResultsPage({ params }: PageProps<'/courses/[courseId]/tests/[testId]/results'>) {
  const { courseId, testId } = await params
  const t = await getTranslations('tests.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<ResultsView>(async (ctx) => {
    const result = await toActionResult(() => getTestResults(ctx, testId)) // mine only; ended only
    if (!result.ok) {
      if (result.code === 'CONFLICT' && result.details?.reason === 'not_ended') return { notEnded: true }
      throw new AppError(result.code, 'Results unavailable', result.details)
    }
    if (result.data.test.courseId !== courseId) throw new AppError('NOT_FOUND', 'Test not in this course')
    return result.data
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const testHref = `/courses/${encodeURIComponent(courseId)}/tests/${encodeURIComponent(testId)}`
  const back = (
    <Link href={testHref} className={buttonVariants({ variant: 'outline' })}>
      <ArrowLeft aria-hidden="true" data-icon="inline-start" />
      {t('backToTest')}
    </Link>
  )

  if ('notEnded' in view.data) {
    return (
      <>
        <PageHeader eyebrow={t('eyebrow')} title={t('results.title')} actions={back} />
        <Panel>
          <p className="text-muted-foreground">{t('results.notEnded')}</p>
        </Panel>
      </>
    )
  }

  const { test, rows, pending } = view.data
  const num = (value: number) => formatDecimal(value, locale)
  const average = rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.score, 0) / rows.length

  return (
    <>
      <PageHeader
        eyebrow={`${t('eyebrow')} · ${test.title}`}
        title={t('results.title')}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <TestStatePill state={test.state} />
            <span>{test.hasShort ? t('results.pendingNote', { count: pending }) : t('results.mcqOnly')}</span>
          </span>
        }
        actions={back}
      />

      <Panel className="flex flex-col gap-1">
        <Eyebrow>{t('results.average')}</Eyebrow>
        <p className="flex items-baseline gap-2">
          <span className="font-display text-6xl leading-none tracking-[0.02em]">
            {average === null ? '—' : num(Math.round(average * 100) / 100)}
          </span>
          <span className="font-mono text-sm text-muted-foreground">{t('results.outOf', { total: num(test.totalMarks) })}</span>
        </p>
      </Panel>

      <section aria-labelledby="test-results" className="flex flex-col gap-4">
        <SectionHeading id="test-results">
          {t('results.students')} · {rows.length}
        </SectionHeading>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{t('live.noStudents')}</p>
        ) : (
          <div className="overflow-hidden rounded-3xl border bg-card">
            <Table>
              <TableCaption className="sr-only">{t('results.tableCaption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="px-4">
                    {t('live.columns.student')}
                  </TableHead>
                  <TableHead scope="col">{t('live.columns.matricule')}</TableHead>
                  <TableHead scope="col">{t('live.columns.status')}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t('results.score')}
                  </TableHead>
                  {test.hasShort && (
                    <TableHead scope="col" className="text-right">
                      {t('results.pending')}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.studentId}>
                    <TableHead scope="row" className="px-4 font-medium">
                      {row.name}
                    </TableHead>
                    <TableCell className="font-mono tracking-[0.04em]">{row.matricule}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'ended' ? 'destructive' : row.status === 'not_joined' ? 'outline' : 'secondary'}>
                        {t(`live.status.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">
                      {t('results.scoreValue', { score: num(row.score), outOf: num(row.outOf) })}
                    </TableCell>
                    {test.hasShort && (
                      <TableCell className="text-right font-mono">{row.pendingShort > 0 ? row.pendingShort : '—'}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  )
}
