import { ArrowLeft, CircleCheck } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { listSubmissions, type AssignmentDetail } from '@/server/assignments/lecturer'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { toLocalDateTimeInput } from '@/server/lib/local-time'
import { loadPage } from '../../../../../load-page'
import { AssignmentForm } from '../../../../assignment-form'

type EditView = { course: CourseSummary; assignment: AssignmentDetail; hasSubmissions: boolean }

export async function generateMetadata() {
  const t = await getTranslations('assignments.lecturer')
  return { title: t('editTitle') }
}

export default async function EditAssignmentPage({
  params,
  searchParams,
}: PageProps<'/courses/[courseId]/assignments/[assignmentId]/edit'>) {
  const { courseId, assignmentId } = await params
  const { created } = await searchParams
  const t = await getTranslations('assignments.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<EditView>(async (ctx) => {
    const { assignment, rows } = await listSubmissions(ctx, assignmentId) // FORBIDDEN unless mine
    if (assignment.courseId !== courseId) throw new AppError('NOT_FOUND', 'Assignment not in this course')
    return {
      course: await getCourse(ctx, courseId),
      assignment,
      hasSubmissions: rows.some((r) => r.submissionId !== null),
    }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, assignment, hasSubmissions } = view.data
  const href = `/courses/${encodeURIComponent(course.id)}/assignments/${encodeURIComponent(assignment.id)}`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('editTitle')}
        description={`${assignment.title} · ${course.title}`}
        actions={
          <Link href={href} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('backToAssignment')}
          </Link>
        }
      />
      {created === '1' && (
        <p role="status" className="-mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          {t('draftSaved')}
        </p>
      )}
      {hasSubmissions && <p className="-mt-4 text-sm text-muted-foreground">{t('form.modeLockedHint')}</p>}
      <Panel>
        <AssignmentForm
          target={{ kind: 'edit', assignmentId: assignment.id }}
          initial={{
            title: assignment.title,
            instructions: assignment.instructions,
            dueAt: toLocalDateTimeInput(assignment.dueAt, config.timeZone),
            maxMark: assignment.maxMark,
            weight: assignment.weight,
            submissionMode: assignment.submissionMode,
            latePolicy: assignment.latePolicy,
            attachments: assignment.attachments,
          }}
          locale={locale}
          timeZone={config.timeZone}
        />
      </Panel>
    </>
  )
}
