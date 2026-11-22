import { ChevronRight, ListChecks } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorCodeMessage } from '@/components/action-error'
import { SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { formatDecimal } from '@/lib/number-format'
import { listMyTests, type MyTestItem } from '@/server/tests/attempt'
import { loadPage } from '../../load-page'

const BADGE: Record<MyTestItem['state'], 'default' | 'secondary' | 'outline'> = {
  not_started: 'outline',
  running: 'default',
  ended: 'secondary',
  released: 'secondary',
}

/** The signed-in student's tests on a course: state, where they stand, the link, and the quick result when visible. */
export async function MyTests({ courseId }: { courseId: string }) {
  const [t, tReview, tCatchUp, rawLocale] = await Promise.all([
    getTranslations('tests.student.myTests'),
    getTranslations('tests.review'),
    getTranslations('tests.catchUp'),
    getLocale(),
  ])
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const result = await loadPage((ctx) => listMyTests(ctx, courseId))

  return (
    <section aria-labelledby="my-tests" className="flex flex-col gap-4">
      <SectionHeading id="my-tests">{t('title')}</SectionHeading>
      {!result.ok ? (
        <p role="alert" className="text-sm text-destructive">
          <ErrorCodeMessage code={result.code} />
        </p>
      ) : result.data.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-3xl border">
          {result.data.map((test) => (
            <li key={test.testId} className="flex items-center">
              <Link
                href={`/t/${encodeURIComponent(test.code)}`}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="max-w-full min-w-0 truncate font-medium">{test.title}</span>
                    {test.isCatchUp && (
                      <Badge variant="secondary" className="shrink-0">
                        {tCatchUp('badge')}
                      </Badge>
                    )}
                    {test.practice && (
                      <Badge variant="outline" className="shrink-0">
                        {t('practice')}
                      </Badge>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t(`status.${test.myStatus}`)} · <span className="font-mono text-xs tracking-[0.04em]">{test.code}</span>
                  </span>
                </span>
                {test.result ? (
                  <span className="font-display text-3xl leading-none whitespace-nowrap">
                    {t('score', {
                      score: formatDecimal(test.result.score, locale),
                      outOf: formatDecimal(test.result.outOf, locale),
                    })}
                  </span>
                ) : (
                  <Badge variant={BADGE[test.state]}>{t(`state.${test.state}`)}</Badge>
                )}
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Link>
              {test.review === 'open' && (
                // Beside the row's link, not inside it: one link per target.
                <Link
                  href={`/t/${encodeURIComponent(test.code)}/review`}
                  className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mr-3 shrink-0 sm:mr-4' })}
                >
                  <ListChecks aria-hidden="true" data-icon="inline-start" />
                  {tReview('myTestsLink')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
