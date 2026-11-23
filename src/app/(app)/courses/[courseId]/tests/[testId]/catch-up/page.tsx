import { ArrowLeft, CircleAlert } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { AppError } from '@/server/core/errors'
import { getCatchUpOptions, type CatchUpOptions } from '@/server/tests/authoring'
import { loadPage } from '../../../../../load-page'
import { CatchUpForm } from '../../../../catch-up-form'

/** Why a test cannot be given a catch-up (CONFLICT reasons of getCatchUpOptions). */
const REFUSALS = { not_ended: 'notEnded', is_catch_up: 'isCatchUp' } as const

function refusalKey(reason: unknown) {
  return typeof reason === 'string' && Object.hasOwn(REFUSALS, reason)
    ? REFUSALS[reason as keyof typeof REFUSALS]
    : undefined
}

export async function generateMetadata() {
  const t = await getTranslations('tests.catchUp')
  return { title: t('give') }
}

export default async function GiveCatchUpPage({ params }: PageProps<'/courses/[courseId]/tests/[testId]/catch-up'>) {
  const { courseId, testId } = await params
  const [t, tLecturer] = await Promise.all([getTranslations('tests.catchUp'), getTranslations('tests.lecturer')])
  const view = await loadPage<CatchUpOptions>(async (ctx) => {
    const options = await getCatchUpOptions(ctx, testId) // mine, ended, not a catch-up
    if (options.original.courseId !== courseId) throw new AppError('NOT_FOUND', 'Test not in this course')
    return options
  })
  const testHref = `/courses/${encodeURIComponent(courseId)}/tests/${encodeURIComponent(testId)}`
  const back = (
    <Link href={testHref} className={buttonVariants({ variant: 'outline' })}>
      <ArrowLeft aria-hidden="true" data-icon="inline-start" />
      {tLecturer('backToTest')}
    </Link>
  )

  if (!view.ok) {
    const refusal = view.code === 'CONFLICT' ? refusalKey(view.details?.reason) : undefined
    if (!refusal) return <ErrorState code={view.code} />
    return (
      <>
        <PageHeader eyebrow={tLecturer('eyebrow')} title={t('give')} actions={back} />
        <Panel role="alert" className="flex items-start gap-3">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <p>{t(`errors.${refusal}`)}</p>
        </Panel>
      </>
    )
  }
  const { original, students, missedCount, answersMayBeOut } = view.data

  return (
    <>
      <PageHeader eyebrow={tLecturer('eyebrow')} title={t('give')} description={original.title} actions={back} />
      <Panel>
        <CatchUpForm
          mode="give"
          testId={original.id}
          courseId={courseId}
          students={students}
          missedCount={missedCount}
          answersMayBeOut={answersMayBeOut}
          started={false}
        />
      </Panel>
    </>
  )
}
