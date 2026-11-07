import { ArrowLeft, ChevronRight, Plus } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { listCourseAssignments, type AssignmentListItem } from '@/server/assignments/lecturer'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { loadPage } from '../../../load-page'
import { formatSessionDate } from '../../attendance-format'

export async function generateMetadata() {
  const t = await getTranslations('assignments.lecturer')
  return { title: t('listTitle') }
}

export default async function AssignmentListPage({ params }: PageProps<'/courses/[courseId]/assignments'>) {
  const { courseId } = await params
  const t = await getTranslations('assignments.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<{ course: CourseSummary; assignments: AssignmentListItem[] }>(async (ctx) => {
    const assignments = await listCourseAssignments(ctx, courseId) // FORBIDDEN unless I teach this course
    return { course: await getCourse(ctx, courseId), assignments }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, assignments } = view.data
  const courseHref = `/courses/${encodeURIComponent(course.id)}`
  const at = now()

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('listTitle')}
        description={`${course.title} · ${course.className}`}
        actions={
          <>
            <Link href={`${courseHref}/assignments/new`} className={buttonVariants({ variant: 'default' })}>
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

      <section aria-labelledby="assignment-list" className="flex flex-col gap-4">
        <SectionHeading id="assignment-list">
          {t('listTitle')} · {t('count', { count: assignments.length })}
        </SectionHeading>
        {assignments.length === 0 ? (
          <p className="text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-3xl border">
            {assignments.map((a) => {
              const missing = Math.max(0, a.rosterSize - a.submittedCount - a.lateCount)
              const due = formatSessionDate(a.dueAt, locale, config.timeZone)
              const past = a.dueAt.getTime() <= at.getTime()
              return (
                <li key={a.id}>
                  <Link
                    href={`${courseHref}/assignments/${encodeURIComponent(a.id)}`}
                    className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/60 sm:px-5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate font-medium">{a.title}</span>
                        {a.status === 'draft' && <Badge variant="outline">{t('draft')}</Badge>}
                        {a.gradesReleasedAt && <Badge variant="secondary">{t('gradesReleased')}</Badge>}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {past ? t('wasDue', { date: due }) : t('due', { date: due })}
                      </span>
                      {a.status === 'published' && (
                        <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">
                          {t('counts', { submitted: a.submittedCount, late: a.lateCount, missing })}
                        </span>
                      )}
                    </div>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
