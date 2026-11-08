import { ArrowLeft, Check, CircleCheck, Lock } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { formatDecimal } from '@/lib/number-format'
import { AppError } from '@/server/core/errors'
import { listLecturerCourses } from '@/server/courses/service'
import { getTestForEdit, type TestForEdit } from '@/server/tests/authoring'
import { questionMark } from '@/server/tests/rules'
import { loadPage } from '../../../../../load-page'
import { CopyTestForm, TestEditor } from '../../../../test-editor'
import { TestStatePill } from '../../../../test-state'

type EditView = { test: TestForEdit; courses: { id: string; label: string }[]; userId: string }

export async function generateMetadata() {
  const t = await getTranslations('tests.lecturer')
  return { title: t('editTitle') }
}

export default async function EditTestPage({
  params,
  searchParams,
}: PageProps<'/courses/[courseId]/tests/[testId]/edit'>) {
  const { courseId, testId } = await params
  const { copied } = await searchParams
  const t = await getTranslations('tests.lecturer')
  const view = await loadPage<EditView>(async (ctx) => {
    const test = await getTestForEdit(ctx, testId) // FORBIDDEN unless mine
    if (test.summary.courseId !== courseId) throw new AppError('NOT_FOUND', 'Test not in this course')
    // Copy targets: my own courses only, this one excluded.
    const courses = (await listLecturerCourses(ctx))
      .filter((c) => c.id !== courseId)
      .map((c) => ({ id: c.id, label: [c.code ? `${c.code} ${c.title}` : c.title, c.className, c.schoolName].join(' · ') }))
    return { test, courses, userId: ctx.user.id }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { test, courses, userId } = view.data
  const { summary, input } = test
  const testHref = `/courses/${encodeURIComponent(courseId)}/tests/${encodeURIComponent(summary.id)}`
  const locked = summary.state !== 'not_started'

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('editTitle')}
        description={summary.title}
        actions={
          <Link href={testHref} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('backToTest')}
          </Link>
        }
      />
      {copied === '1' && (
        <p role="status" className="-mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          {t('copiedNote')}
        </p>
      )}

      {locked ? (
        <LockedTest test={test} />
      ) : (
        <TestEditor courseId={courseId} testId={summary.id} userId={userId} saved={input} />
      )}

      <section aria-labelledby="test-copy" className="flex flex-col gap-4">
        <SectionHeading id="test-copy">{t('copy.title')}</SectionHeading>
        <Panel>
          <CopyTestForm testId={summary.id} courses={courses} />
        </Panel>
      </section>
    </>
  )
}

/** After Start: the questions as they are, read-only (they are locked from Start). */
async function LockedTest({ test }: { test: TestForEdit }) {
  const t = await getTranslations('tests.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const { summary, input } = test
  const mark = (value: number) => formatDecimal(value, locale)

  return (
    <div className="flex flex-col gap-4">
      <p className="inline-flex items-center gap-2 text-sm font-medium">
        <Lock aria-hidden="true" className="size-4 shrink-0" />
        {t('editor.locked')}
      </p>
      <Panel className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TestStatePill state={summary.state} />
        <span className="text-sm text-muted-foreground">
          {t('questionCount', { count: summary.questionCount })} ·{' '}
          {t('totalMarks', { total: mark(summary.totalMarks), count: summary.totalMarks })} ·{' '}
          {t('duration', { minutes: summary.durationMinutes })}
        </span>
      </Panel>
      <ol className="flex flex-col gap-4">
        {input.questions.map((q, index) => (
          <li key={q.id} className="flex flex-col gap-3 rounded-3xl border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Eyebrow>
                {t('editor.questionN', { n: index + 1 })} ·{' '}
                {q.kind === 'mcq' ? t('editor.kindMcq') : t('editor.kindShort')}
              </Eyebrow>
              <span className="font-mono text-xs text-muted-foreground">
                {t('totalMarks', {
                  total: mark(questionMark(q, input.defaultMark)),
                  count: questionMark(q, input.defaultMark),
                })}
              </span>
            </div>
            <p className="whitespace-pre-wrap">{q.prompt}</p>
            {q.kind === 'mcq' ? (
              <ul className="flex flex-col gap-1.5">
                {q.options.map((o, oi) => (
                  <li key={oi} className="flex items-start gap-2 text-sm">
                    {o.correct ? (
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : (
                      <span aria-hidden="true" className="size-4 shrink-0" />
                    )}
                    <span className={o.correct ? 'font-medium' : undefined}>
                      {o.text}
                      {o.correct && <span className="sr-only"> ({t('editor.correctAnswer')})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-1 rounded-2xl bg-muted/60 p-3.5">
                <Eyebrow>{t('editor.guide')}</Eyebrow>
                <p className="text-sm whitespace-pre-wrap">{q.guide}</p>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
