import { Clock, MessageSquare } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Eyebrow, PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { formatDecimal } from '@/lib/number-format'
import type { MyTestResult } from '@/server/tests/results'

/**
 * A released test with short answers (the release email links here): the total, then each
 * question's mark and the lecturer's comment. Never the options or which one was correct. A real
 * answer still to be confirmed reads "Being marked", never 0.
 */
export async function ReleasedResult({ result }: { result: MyTestResult }) {
  const [t, locale] = await Promise.all([getTranslations('tests.released'), getLocale()])
  const tStudent = await getTranslations('tests.student')
  const num = (value: number) => formatDecimal(value, locale)

  return (
    <>
      <PageHeader eyebrow={`${t('eyebrow')} · ${result.courseTitle}`} title={result.title} />

      <Panel className="flex flex-col items-center gap-2 py-10 text-center">
        <Eyebrow>{t('total')}</Eyebrow>
        <span className="font-display text-[min(18vw,6rem)] leading-none">
          {t('score', { score: num(result.score), outOf: num(result.outOf) })}
        </span>
        {!result.joined && <p className="text-muted-foreground">{t('notJoined')}</p>}
        {result.pending > 0 && <p className="font-medium">{t('pendingNote', { count: result.pending })}</p>}
        <p className="text-sm text-muted-foreground">{t('onlyYou')}</p>
      </Panel>

      <section aria-labelledby="released-questions" className="flex flex-col gap-4">
        <SectionHeading id="released-questions">
          {t('questions')} · {result.questions.length}
        </SectionHeading>
        <ol className="flex flex-col gap-3">
          {result.questions.map((q) => (
            <li key={q.number} className="flex flex-col gap-3 rounded-3xl border bg-card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <Eyebrow>
                    {t('question', { n: q.number })} · {t(`kind.${q.kind}`)}
                  </Eyebrow>
                  <p className="font-medium break-words whitespace-pre-wrap">{q.prompt}</p>
                </div>
                {q.mark === null ? (
                  <Badge variant="outline" className="shrink-0">
                    <Clock aria-hidden="true" />
                    {t('pending')}
                  </Badge>
                ) : (
                  <span className="shrink-0 font-mono text-base font-semibold whitespace-nowrap">
                    {t('mark', { mark: num(q.mark), outOf: num(q.outOf) })}
                  </span>
                )}
              </div>
              {q.comment && (
                <div className="flex items-start gap-2.5 rounded-2xl bg-muted px-4 py-3 text-sm">
                  <MessageSquare aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Eyebrow className="text-[11px]">{t('comment')}</Eyebrow>
                    <p className="break-words whitespace-pre-wrap">{q.comment}</p>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'lg', className: 'self-start' })}>
        {tStudent('backToDashboard')}
      </Link>
    </>
  )
}
