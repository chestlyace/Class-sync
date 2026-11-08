import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { getTestForEdit } from '@/server/tests/authoring'
import type { TestState } from '@/server/tests/phase'
import { getLiveTest } from '@/server/tests/run'
import { loadPage } from '../../../../load-page'
import type { LiveTestView } from '../../../test-actions'
import { TestLive } from '../../../test-live'
import { TestStatePill } from '../../../test-state'

type LiveView = { course: CourseSummary; live: LiveTestView; state: TestState }

/** The student link, `/t/<CODE>`, absolute when BETTER_AUTH_URL is set (as in emails). */
function testLink(code: string): string {
  const base = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  return `${base}/t/${encodeURIComponent(code)}`
}

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
    return {
      course: await getCourse(ctx, courseId),
      live: { ...live, endsAt: live.endsAt?.toISOString() ?? null, serverNow: live.serverNow.toISOString() },
      state: summary.state,
    }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, live, state } = view.data

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={live.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <TestStatePill state={state} />
            <span>{`${course.title} · ${course.className}`}</span>
          </span>
        }
        actions={
          <Link href={`/courses/${encodeURIComponent(course.id)}/tests`} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('allTests')}
          </Link>
        }
      />
      {/* A new phase (Start, End, deadline) remounts the live view with fresh state. */}
      <TestLive key={live.phase} initial={live} courseId={course.id} link={testLink(live.code)} timeZone={config.timeZone} />
    </>
  )
}
