import { ArrowLeft, Lock } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ErrorState } from '@/components/error-state'
import { FileList } from '@/components/file-list'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { RichTextView } from '@/components/rich-text-view'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { displayKind } from '@/lib/file-display'
import { formatDecimal } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import { listSubmissions } from '@/server/assignments/lecturer'
import { isRichTextEmpty } from '@/server/assignments/rich-text'
import {
  getAssignmentForStudent,
  type AssignmentDetail,
  type MySubmission,
  type StudentSubmitVerdict,
} from '@/server/assignments/student'
import type { FileInfo } from '@/server/files/service'
import { config } from '@/server/core/config'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { formatSessionDate } from '../../courses/attendance-format'
import { loadPage } from '../../load-page'
import { SubmitForm } from '../submit-form'

type StudentView = {
  kind: 'student'
  userId: string
  course: CourseSummary
  assignment: AssignmentDetail
  mySubmission: MySubmission | null
  canSubmit: StudentSubmitVerdict
  now: Date
}

type View = StudentView | { kind: 'lecturer'; href: string }

export async function generateMetadata() {
  const t = await getTranslations('assignments.student')
  return { title: t('eyebrow') }
}

/**
 * The student's assignment page (emails link here): the brief, then their hand-in, then the grade
 * once released. A lecturer who owns the assignment is sent to their own page for it.
 */
export default async function StudentAssignmentPage({ params }: PageProps<'/assignments/[assignmentId]'>) {
  const { assignmentId } = await params
  const t = await getTranslations('assignments.student')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<View>(async (ctx) => {
    if (ctx.user.role === 'lecturer') {
      const { assignment } = await listSubmissions(ctx, assignmentId) // FORBIDDEN unless mine
      return {
        kind: 'lecturer',
        href: `/courses/${encodeURIComponent(assignment.courseId)}/assignments/${encodeURIComponent(assignment.id)}`,
      }
    }
    // FORBIDDEN unless published and the student is on the course's roster.
    const { assignment, mySubmission, canSubmit } = await getAssignmentForStudent(ctx, assignmentId)
    const course = await getCourse(ctx, assignment.courseId)
    return { kind: 'student', userId: ctx.user.id, course, assignment, mySubmission, canSubmit, now: new Date() }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  if (view.data.kind === 'lecturer') redirect(view.data.href)

  const { userId, course, assignment, mySubmission, canSubmit, now } = view.data
  const date = (d: Date) => formatSessionDate(d, locale, config.timeZone)
  const num = (n: number) => formatDecimal(n, locale)
  // Past a hard deadline, or once grades are released (ruling B9): the work is read-only.
  const readOnly = canSubmit !== 'ok'
  const pastDue = assignment.dueAt.getTime() < now.getTime()
  const mark = assignment.gradesReleasedAt !== null ? (mySubmission?.mark ?? null) : null

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={assignment.title}
        description={`${course.title} · ${t('taughtBy', { name: course.lecturerName })}`}
        actions={
          <Link href={`/courses/${encodeURIComponent(course.id)}`} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('backToCourse')}
          </Link>
        }
      />

      <Panel className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Fact label={t('due')} className="col-span-2 sm:col-span-1">
            {date(assignment.dueAt)}
            <span className="block text-xs text-muted-foreground">{config.timeZone}</span>
          </Fact>
          <Fact label={t('maxMark')}>
            <span className="font-mono">{num(assignment.maxMark)}</span>
          </Fact>
          <Fact label={t('handIn')}>{t(`mode.${assignment.submissionMode}`)}</Fact>
        </dl>
        {readOnly ? (
          <p className="flex items-start gap-2 border-t pt-4 text-sm font-medium">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {canSubmit === 'released' ? t('releasedNote') : t('closedNote')}
          </p>
        ) : (
          pastDue && <p className="border-t pt-4 text-sm text-muted-foreground">{t('lateNote')}</p>
        )}
      </Panel>

      {mark !== null && mySubmission && (
        <section aria-labelledby="assignment-grade" className="flex flex-col gap-4">
          <SectionHeading id="assignment-grade">{t('grade')}</SectionHeading>
          <Panel className="flex flex-col gap-4">
            <p className="font-display text-6xl leading-none">
              {num(mark)} <span className="text-muted-foreground">/ {num(assignment.maxMark)}</span>
            </p>
            {mySubmission.feedback ? (
              <div className="flex flex-col gap-1 border-t pt-4">
                <span className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
                  {t('feedback')}
                </span>
                <p className="break-words whitespace-pre-wrap">{mySubmission.feedback}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noFeedback')}</p>
            )}
          </Panel>
        </section>
      )}

      <section aria-labelledby="assignment-instructions" className="flex flex-col gap-4">
        <SectionHeading id="assignment-instructions">{t('instructions')}</SectionHeading>
        {isRichTextEmpty(assignment.instructions) ? (
          <p className="text-muted-foreground">{t('noInstructions')}</p>
        ) : (
          <Panel>
            <RichTextView value={assignment.instructions} locale={locale} />
          </Panel>
        )}
        {assignment.attachments.length > 0 && (
          <FileList files={assignment.attachments} locale={locale} openLabel={fileLabel(t)} />
        )}
      </section>

      <section aria-labelledby="assignment-my-work" className="flex flex-col gap-4">
        <SectionHeading id="assignment-my-work">{t('yourWork')}</SectionHeading>
        {readOnly ? (
          <ClosedWork submission={mySubmission} locale={locale} />
        ) : (
          <Panel className="flex flex-col gap-5">
            <SubmitForm
              userId={userId}
              assignmentId={assignment.id}
              mode={assignment.submissionMode}
              locale={locale}
              timeZone={config.timeZone}
              submitted={mySubmission && { at: mySubmission.submittedAt, isLate: mySubmission.isLate }}
              submittedText={mySubmission?.text ?? null}
              submittedFiles={mySubmission?.files ?? []}
            />
          </Panel>
        )}
      </section>
    </>
  )
}

/** Past a hard deadline or after the release of grades: what was handed in, read-only (or that nothing was). */
async function ClosedWork({ submission, locale }: { submission: MySubmission | null; locale: 'en' | 'fr' }) {
  const t = await getTranslations('assignments.student')
  if (!submission) return <p className="text-muted-foreground">{t('nothingHandedIn')}</p>
  const hasText = submission.text !== null && !isRichTextEmpty(submission.text)
  return (
    <Panel className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {t('submittedOn', { date: formatSessionDate(submission.submittedAt, locale, config.timeZone) })}
        {submission.isLate && <Badge variant="destructive">{t('late')}</Badge>}
      </p>
      {hasText && <RichTextView value={submission.text} locale={locale} />}
      {submission.files.length > 0 && (
        <FileList files={submission.files} locale={locale} openLabel={fileLabel(t)} />
      )}
    </Panel>
  )
}

/** "Open x" for files the browser shows (PDF, JPEG/PNG/WebP), "Download x" for the rest (Word, HEIC). */
function fileLabel(t: (key: 'openFile' | 'downloadFile', values: { name: string }) => string) {
  return (name: string, file: FileInfo) => t(displayKind(file.mimeType) === 'download' ? 'downloadFile' : 'openFile', { name })
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <dt className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
