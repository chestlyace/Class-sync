import { ArrowLeft, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { toActionResult } from '@/lib/action-result'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { getMarkingQuestion, type MarkingQuestion } from '@/server/tests/marking'
import { requireOwnedTest } from '@/server/tests/queries'
import { loadPage } from '../../../../../load-page'
import { formatSessionDate } from '../../../../attendance-format'
import { MarkingPanel } from '../../../../marking-panel'

type MarkView =
  | { state: 'ready'; title: string; question: MarkingQuestion }
  | { state: 'not_final'; title: string; finalAt: string | null }
  | { state: 'automatic'; title: string }

export async function generateMetadata() {
  const t = await getTranslations('tests.marking')
  return { title: t('metaTitle') }
}

/**
 * Mark by question (`TestMark`): one short-answer question and its guide, every real answer with
 * its AI suggestion to confirm or change. `?q=<questionId>` picks the question; without it, the
 * first one with answers still to confirm.
 */
export default async function MarkPage({ params, searchParams }: PageProps<'/courses/[courseId]/tests/[testId]/mark'>) {
  const { courseId, testId } = await params
  const { q } = await searchParams
  const questionId = typeof q === 'string' && q !== '' ? q : null
  const t = await getTranslations('tests.marking')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE

  const view = await loadPage<MarkView>(async (ctx) => {
    const { test } = await requireOwnedTest(ctx, testId) // mine only
    if (test.courseId !== courseId) throw new AppError('NOT_FOUND', 'Test not in this course')
    const result = await toActionResult(() => getMarkingQuestion(ctx, testId, questionId))
    if (result.ok) return { state: 'ready', title: test.title, question: result.data }
    const reason = result.code === 'CONFLICT' ? result.details?.reason : undefined
    if (reason === 'not_final') {
      const finalAt = result.details?.finalAt
      return { state: 'not_final', title: test.title, finalAt: typeof finalAt === 'string' ? finalAt : null }
    }
    if (reason === 'automatic') return { state: 'automatic', title: test.title }
    throw new AppError(result.code, 'Marking unavailable', result.details)
  })
  if (!view.ok) return <ErrorState code={view.code} />

  const testHref = `/courses/${encodeURIComponent(courseId)}/tests/${encodeURIComponent(testId)}`
  const markHref = (id: string) => `${testHref}/mark?q=${encodeURIComponent(id)}`
  const data = view.data
  const header = (
    <PageHeader
      eyebrow={`${t('eyebrow')} · ${data.title}`}
      title={t('metaTitle')}
      actions={
        <Link href={`${testHref}/results`} className={buttonVariants({ variant: 'outline' })}>
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          {t('backToResults')}
        </Link>
      }
    />
  )

  if (data.state !== 'ready') {
    let message: string
    if (data.state === 'automatic') message = t('automatic')
    else if (data.finalAt === null) message = t('notFinalNoTime')
    else message = t('notFinal', { time: formatSessionDate(new Date(data.finalAt), locale, config.timeZone, 'time') })
    return (
      <>
        {header}
        <Panel role="status" className="flex items-start gap-3">
          <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <p>{message}</p>
        </Panel>
      </>
    )
  }

  const { question } = data
  return (
    <>
      {header}
      <nav aria-label={t('navLabel')} className="-mt-4 flex flex-wrap items-center gap-2">
        {question.prevId ? (
          <Link href={markHref(question.prevId)} className={buttonVariants({ variant: 'outline' })}>
            <ChevronLeft aria-hidden="true" data-icon="inline-start" />
            {t('previous')}
          </Link>
        ) : (
          <span aria-hidden="true" className={buttonVariants({ variant: 'outline', className: 'pointer-events-none opacity-40' })}>
            <ChevronLeft data-icon="inline-start" />
            {t('previous')}
          </span>
        )}
        <span className="px-2 font-mono text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {t('questionLabel', { number: question.number, index: question.shortIndex, count: question.shortCount })}
        </span>
        {question.nextId ? (
          <Link href={markHref(question.nextId)} className={buttonVariants({ variant: 'outline' })}>
            {t('next')}
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        ) : (
          <span aria-hidden="true" className={buttonVariants({ variant: 'outline', className: 'pointer-events-none opacity-40' })}>
            {t('next')}
            <ChevronRight data-icon="inline-end" />
          </span>
        )}
      </nav>
      {/* A new question starts a fresh panel (its own suggestion request, its own drafts). */}
      <MarkingPanel key={question.questionId} question={question} />
    </>
  )
}
