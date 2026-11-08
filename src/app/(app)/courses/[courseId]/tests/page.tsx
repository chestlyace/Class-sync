import { ArrowLeft, ChevronRight, Info, Plus } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { formatDecimal } from '@/lib/number-format'
import { config } from '@/server/core/config'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { getCaSettings } from '@/server/performance/inputs'
import { listCourseTests, type TestSummary } from '@/server/tests/authoring'
import { loadPage } from '../../../load-page'
import { formatSessionDate } from '../../attendance-format'
import { TestStatePill } from '../../test-state'

export async function generateMetadata() {
  const t = await getTranslations('tests.lecturer')
  return { title: t('listTitle') }
}

export default async function TestListPage({ params }: PageProps<'/courses/[courseId]/tests'>) {
  const { courseId } = await params
  const t = await getTranslations('tests.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<{ course: CourseSummary; tests: TestSummary[]; testPoints: number }>(async (ctx) => {
    const tests = await listCourseTests(ctx, courseId) // FORBIDDEN unless I teach this course
    const [course, settings] = await Promise.all([getCourse(ctx, courseId), getCaSettings(ctx.db, courseId)])
    return { course, tests, testPoints: settings.testPoints }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, tests, testPoints } = view.data
  const courseHref = `/courses/${encodeURIComponent(course.id)}`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('listTitle')}
        description={`${course.title} · ${course.className}`}
        actions={
          <>
            <Link href={`${courseHref}/tests/new`} className={buttonVariants({ variant: 'default' })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('new')}
            </Link>
            <Link href={courseHref} className={buttonVariants({ variant: 'outline' })}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {course.title}
            </Link>
          </>
        }
      />

      {testPoints === 0 && (
        // Every test counts toward the CA, but only once the CA gives tests some points.
        <p className="flex items-start gap-2 rounded-3xl border bg-muted/40 px-4 py-3 text-sm sm:px-5">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {t('pointsZero')}{' '}
            <Link href={`${courseHref}/performance#ca-settings`} className="font-medium text-primary underline-offset-4 hover:underline">
              {t('pointsLink')}
            </Link>
          </span>
        </p>
      )}

      <section aria-labelledby="test-list" className="flex flex-col gap-4">
        <SectionHeading id="test-list">
          {t('listTitle')} · {t('count', { count: tests.length })}
        </SectionHeading>
        {tests.length === 0 ? (
          <p className="max-w-prose text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-3xl border">
            {tests.map((test) => (
              <li key={test.id}>
                <Link
                  href={`${courseHref}/tests/${encodeURIComponent(test.id)}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/60 sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{test.title}</span>
                      <TestStatePill state={test.state} />
                      {test.state === 'not_started' && test.joined > 0 && (
                        <span className="text-sm text-muted-foreground">{t('waiting', { count: test.joined })}</span>
                      )}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t('questionCount', { count: test.questionCount })} ·{' '}
                      {t('totalMarks', { total: formatDecimal(test.totalMarks, locale), count: test.totalMarks })} ·{' '}
                      {t('duration', { minutes: test.durationMinutes })}
                    </span>
                    {test.startedAt && (
                      <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">
                        {t('startedOn', { date: formatSessionDate(test.startedAt, locale, config.timeZone) })}
                      </span>
                    )}
                  </div>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
