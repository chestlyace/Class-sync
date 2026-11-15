import { Check, Clock, MessageSquare, RotateCcw, X } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { formatDecimal } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import { getTestReview, type ReviewQuestion } from '@/server/tests/review'
import { loadPage } from '@/app/(app)/load-page'
import { resolveStudentTest } from '../student-test'

export async function generateMetadata() {
  const t = await getTranslations('tests.review')
  return { title: t('metaTitle') }
}

/**
 * A student's review of a released test: every question with their answer, the correct one, their
 * mark and the lecturer's comment. Not open (switched off, not released, held) → back to the test.
 */
export default async function TestReviewPage({ params }: PageProps<'/t/[code]/review'>) {
  const { code } = await params
  const resolved = await resolveStudentTest(code, 'review')
  if (!resolved.ok) return resolved.screen
  const { testId } = resolved
  const review = await loadPage((ctx) => getTestReview(ctx, testId))
  if (!review.ok) {
    if (review.code === 'CONFLICT') redirect(`/t/${encodeURIComponent(code)}`)
    return <ErrorState code={review.code} />
  }
  const data = review.data
  const [t, tr, locale] = await Promise.all([getTranslations('tests.review'), getTranslations('tests.released'), getLocale()])
  const num = (value: number) => formatDecimal(value, locale)
  const testHref = `/t/${encodeURIComponent(code)}`

  return (
    <>
      <PageHeader eyebrow={`${t('eyebrow')} · ${data.courseTitle}`} title={data.title} />

      <Panel className="flex flex-col items-center gap-2 py-8 text-center">
        <Eyebrow>{t('total')}</Eyebrow>
        <span className="font-display text-[min(16vw,5rem)] leading-none">
          {tr('score', { score: num(data.score), outOf: num(data.outOf) })}
        </span>
        {!data.joined && <p className="text-muted-foreground">{t('notJoined')}</p>}
        {data.pending > 0 && <p className="font-medium">{tr('pendingNote', { count: data.pending })}</p>}
      </Panel>

      <ol className="flex flex-col gap-3">
        {data.questions.map((q) => (
          <li key={q.id} className="flex flex-col gap-4 rounded-3xl border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <Eyebrow>
                  {tr('question', { n: q.number })} · {tr(`kind.${q.kind}`)}
                </Eyebrow>
                <p className="font-medium break-words whitespace-pre-wrap">{q.prompt}</p>
              </div>
              {q.mark === null ? (
                <Badge variant="outline" className="shrink-0">
                  <Clock aria-hidden="true" />
                  {tr('pending')}
                </Badge>
              ) : (
                <span className="shrink-0 font-mono text-base font-semibold whitespace-nowrap">
                  {tr('mark', { mark: num(q.mark), outOf: num(q.outOf) })}
                </span>
              )}
            </div>
            {q.kind === 'mcq' ? <McqReview question={q} /> : <ShortReview question={q} />}
            {q.comment && (
              <div className="flex items-start gap-2.5 rounded-2xl bg-muted px-4 py-3 text-sm">
                <MessageSquare aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Eyebrow className="text-[11px]">{tr('comment')}</Eyebrow>
                  <p className="break-words whitespace-pre-wrap">{q.comment}</p>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Link href={`${testHref}/practice`} className={buttonVariants({ size: 'lg' })}>
          <RotateCcw aria-hidden="true" data-icon="inline-start" />
          {t('practise')}
        </Link>
        <Link href={testHref} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          {t('backToTest')}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">{t('practiseNote')}</p>
    </>
  )
}

/** The options in the lecturer's order: the correct one and the student's pick are named, never shown by colour alone. */
async function McqReview({ question }: { question: ReviewQuestion }) {
  const t = await getTranslations('tests.review')
  const answered = question.options.some((o) => o.picked)
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {question.options.map((o) => {
          const wrongPick = o.picked && !o.isCorrect
          return (
            <li
              key={o.id}
              className={cn(
                'flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-2xl border px-4 py-3 text-sm',
                o.isCorrect && 'border-foreground bg-muted',
                wrongPick && 'border-destructive bg-destructive/5',
                !o.isCorrect && !wrongPick && 'text-muted-foreground',
              )}
            >
              {/* A floor on the text's width, so two badges wrap below it instead of squeezing it. */}
              <span className="min-w-40 flex-1 break-words">{o.text}</span>
              <span className="flex flex-wrap gap-1.5">
                {o.picked && (
                  <Badge variant={o.isCorrect ? 'secondary' : 'destructive'}>
                    {o.isCorrect ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
                    {t('yourAnswer')}
                  </Badge>
                )}
                {o.isCorrect && (
                  <Badge>
                    <Check aria-hidden="true" />
                    {t('correctAnswer')}
                  </Badge>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {!answered && <p className="text-sm text-muted-foreground">{t('noAnswer')}</p>}
    </div>
  )
}

/** The student's own answer, then what the lecturer was looking for. */
async function ShortReview({ question }: { question: ReviewQuestion }) {
  const t = await getTranslations('tests.review')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-2xl border px-4 py-3">
        <Eyebrow className="text-[11px]">{t('yourAnswer')}</Eyebrow>
        {question.answerText ? (
          <p className="text-sm break-words whitespace-pre-wrap">{question.answerText}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noAnswer')}</p>
        )}
      </div>
      {question.guide && (
        <div className="flex flex-col gap-1 rounded-2xl bg-muted/60 px-4 py-3">
          <Eyebrow className="text-[11px]">{t('lookingFor')}</Eyebrow>
          <p className="text-sm break-words whitespace-pre-wrap">{question.guide}</p>
        </div>
      )}
    </div>
  )
}
