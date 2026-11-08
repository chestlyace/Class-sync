import { ArrowLeft, CircleCheck, Clock, PenLine, Unlock } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { toActionResult } from '@/lib/action-result'
import { formatDecimal } from '@/lib/number-format'
import { config } from '@/server/core/config'
import { now } from '@/server/core/clock'
import { AppError } from '@/server/core/errors'
import { answersFinalAt } from '@/server/tests/phase'
import { requireOwnedTest } from '@/server/tests/queries'
import { getTestResults, type ResultRow } from '@/server/tests/run'
import type { TestSummary } from '@/server/tests/authoring'
import type { Locale } from '@/server/core/context'
import { loadPage } from '../../../../../load-page'
import { formatSessionDate } from '../../../../attendance-format'
import { ReleaseResultsButton } from '../../../../marking-panel'
import { TestStatePill } from '../../../../test-state'

type ResultsView =
  | {
      test: TestSummary
      rows: ResultRow[]
      pending: number
      /** When answers become final (release and marking open then); null if never started. */
      finalAt: Date | null
      releasedAt: Date | null
      at: Date
    }
  | { notEnded: true }

/** "09:41" today, else "Mon 9 Nov, 09:41", in the school's time zone. */
function formatWhen(date: Date, at: Date, locale: Locale): string {
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format(d)
  return formatSessionDate(date, locale, config.timeZone, day(date) === day(at) ? 'time' : 'short')
}

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
    const { test } = await requireOwnedTest(ctx, testId)
    return { ...result.data, finalAt: answersFinalAt(test), releasedAt: test.resultsReleasedAt, at: now() }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const tm = await getTranslations('tests')
  const testHref = `/courses/${encodeURIComponent(courseId)}/tests/${encodeURIComponent(testId)}`
  const markHref = `${testHref}/mark`
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

  const { test, rows, pending, finalAt, releasedAt, at } = view.data
  const num = (value: number) => formatDecimal(value, locale)
  const average = rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.score, 0) / rows.length
  const final = finalAt !== null && at.getTime() >= finalAt.getTime()
  const markLink = (
    <Link href={markHref} className={buttonVariants({ variant: 'outline' })}>
      <PenLine aria-hidden="true" data-icon="inline-start" />
      {tm('marking.markShort')}
    </Link>
  )

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

      {test.hasShort && (
        <section aria-labelledby="test-release" className="flex flex-col gap-4">
          <SectionHeading id="test-release">{tm('release.heading')}</SectionHeading>
          <Panel className="flex flex-col items-start gap-3">
            {releasedAt !== null ? (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <CircleCheck aria-hidden="true" className="size-5 shrink-0" />
                  {tm('release.released', { time: formatWhen(releasedAt, at, locale) })}
                </p>
                <p className="text-sm text-muted-foreground">{tm('release.releasedNote')}</p>
                {pending > 0 && <p className="text-sm font-medium">{tm('release.toConfirm', { count: pending })}</p>}
                {markLink}
              </>
            ) : !final ? (
              <>
                <Button type="button" disabled>
                  <Unlock aria-hidden="true" data-icon="inline-start" />
                  {tm('release.button')}
                </Button>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock aria-hidden="true" className="size-4 shrink-0" />
                  {finalAt ? tm('release.notFinal', { time: formatWhen(finalAt, at, locale) }) : tm('marking.notFinalNoTime')}
                </p>
              </>
            ) : pending > 0 ? (
              <>
                <Button type="button" disabled aria-describedby="release-blocked">
                  <Unlock aria-hidden="true" data-icon="inline-start" />
                  {tm('release.button')}
                </Button>
                <p id="release-blocked" className="text-sm font-medium">
                  {tm('release.toConfirm', { count: pending })}
                </p>
                {markLink}
              </>
            ) : (
              <ReleaseResultsButton testId={test.id} />
            )}
          </Panel>
        </section>
      )}

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
