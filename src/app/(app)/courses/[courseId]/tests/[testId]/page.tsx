import { ArrowLeft, ChevronRight, FileText, PenLine, RotateCcw } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { getTestForEdit, listCourseTests, type TestSummary } from '@/server/tests/authoring'
import type { TestState } from '@/server/tests/phase'
import { getLiveTest } from '@/server/tests/run'
import { absoluteLink, testLinkPath } from '@/app/share-links'
import { loadPage } from '../../../../load-page'
import type { LiveTestView } from '../../../test-actions'
import { ReviewSwitch } from '../../../review-switch'
import { TestLive } from '../../../test-live'
import { CatchUpAudience, TestStatePill } from '../../../test-state'

type LiveView = {
  course: CourseSummary
  live: LiveTestView
  state: TestState
  hasShort: boolean
  studentsCanReview: boolean
  /** The test this one catches up on; null for an original. */
  catchUpOf: TestSummary['catchUpOf']
  /** An ended original's catch-ups, newest first; empty otherwise. */
  catchUps: TestSummary[]
}

const ENDED: TestState[] = ['ended', 'released']

export async function generateMetadata() {
  const t = await getTranslations('tests.lecturer')
  return { title: t('eyebrow') }
}

export default async function TestLivePage({ params }: PageProps<'/courses/[courseId]/tests/[testId]'>) {
  const { courseId, testId } = await params
  const t = await getTranslations('tests.lecturer')
  const view = await loadPage<LiveView>(async (ctx) => {
    const [live, { summary }] = await Promise.all([getLiveTest(ctx, testId), getTestForEdit(ctx, testId)]) // mine only
    if (live.courseId !== courseId) throw new AppError('NOT_FOUND', 'Test not in this course')
    // Catch-ups are given once a test has ended, so only an ended original can have any.
    const original = summary.catchUpOf === null && ENDED.includes(summary.state)
    const [course, courseTests] = await Promise.all([
      getCourse(ctx, courseId),
      original ? listCourseTests(ctx, courseId) : Promise.resolve([]),
    ])
    return {
      course,
      live: { ...live, endsAt: live.endsAt?.toISOString() ?? null, serverNow: live.serverNow.toISOString() },
      state: summary.state,
      hasShort: summary.hasShort,
      studentsCanReview: summary.studentsCanReview,
      catchUpOf: summary.catchUpOf,
      catchUps: courseTests.filter((c) => c.catchUpOf?.id === summary.id),
    }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, live, state, hasShort, studentsCanReview, catchUpOf, catchUps } = view.data
  const [tm, tReview, tCatchUp] = await Promise.all([
    getTranslations('tests.marking'),
    getTranslations('tests.review'),
    getTranslations('tests.catchUp'),
  ])
  const testsHref = `/courses/${encodeURIComponent(course.id)}/tests`
  const testHref = `${testsHref}/${encodeURIComponent(live.testId)}`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={live.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {catchUpOf && <Badge variant="secondary">{tCatchUp('badge')}</Badge>}
            <TestStatePill state={state} />
            <span>{`${course.title} · ${course.className}`}</span>
            {catchUpOf && (
              <Link
                href={`${testsHref}/${encodeURIComponent(catchUpOf.id)}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {tCatchUp('original', { title: catchUpOf.title })}
              </Link>
            )}
          </span>
        }
        actions={
          <>
            <Link href={testsHref} className={buttonVariants({ variant: 'outline' })}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('allTests')}
            </Link>
            {catchUpOf === null && ENDED.includes(state) && (
              <Link href={`${testHref}/catch-up`} className={buttonVariants({ variant: 'outline' })}>
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {tCatchUp('give')}
              </Link>
            )}
            {state !== 'not_started' && (
              <Link href={`${testHref}/edit`} className={buttonVariants({ variant: 'outline' })}>
                <FileText aria-hidden="true" data-icon="inline-start" />
                {tReview('questions')}
              </Link>
            )}
            {hasShort && (state === 'ended' || state === 'released') && (
              <Link href={`${testHref}/mark`} className={buttonVariants({ variant: 'outline' })}>
                <PenLine aria-hidden="true" data-icon="inline-start" />
                {tm('markShort')}
              </Link>
            )}
          </>
        }
      />
      <ReviewSwitch testId={live.testId} initial={studentsCanReview} />
      {/* A new phase (Start, End, deadline) remounts the live view with fresh state. */}
      <TestLive key={live.phase} initial={live} courseId={course.id} link={await absoluteLink(testLinkPath(live.code))} timeZone={config.timeZone} />
      {catchUps.length > 0 && (
        <section aria-labelledby="test-catch-ups" className="flex flex-col gap-4">
          <SectionHeading id="test-catch-ups">
            {tCatchUp('listHeading')} · {catchUps.length}
          </SectionHeading>
          <ul className="flex flex-col divide-y rounded-3xl border">
            {catchUps.map((catchUp) => (
              <li key={catchUp.id}>
                <Link
                  href={`${testsHref}/${encodeURIComponent(catchUp.id)}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/60 sm:px-5"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-medium">{catchUp.title}</span>
                      <TestStatePill state={catchUp.state} />
                    </span>
                    {catchUp.catchUpFor && (
                      <span className="text-sm text-muted-foreground">
                        <CatchUpAudience catchUpFor={catchUp.catchUpFor} pickedCount={catchUp.pickedCount} />
                      </span>
                    )}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
