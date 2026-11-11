import { ArrowLeft, ChevronRight, Pencil } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { FileList } from '@/components/file-list'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { RichTextView } from '@/components/rich-text-view'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { formatDecimal } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import { listSubmissions, type AssignmentDetail, type SubmissionRow } from '@/server/assignments/lecturer'
import { isRichTextEmpty } from '@/server/assignments/rich-text'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { loadPage } from '../../../../load-page'
import { DeleteDraftButton, PublishButton, ReleaseGradesButton } from '../../../assignment-controls'
import { formatSessionDate } from '../../../attendance-format'

type DetailView = { course: CourseSummary; assignment: AssignmentDetail; rows: SubmissionRow[]; now: Date }

export async function generateMetadata() {
  const t = await getTranslations('assignments.lecturer')
  return { title: t('eyebrow') }
}

export default async function AssignmentDetailPage({
  params,
}: PageProps<'/courses/[courseId]/assignments/[assignmentId]'>) {
  const { courseId, assignmentId } = await params
  const t = await getTranslations('assignments.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<DetailView>(async (ctx) => {
    const { assignment, rows } = await listSubmissions(ctx, assignmentId) // FORBIDDEN unless mine
    if (assignment.courseId !== courseId) throw new AppError('NOT_FOUND', 'Assignment not in this course')
    return { course: await getCourse(ctx, courseId), assignment, rows, now: new Date() }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, assignment, rows, now } = view.data
  const courseHref = `/courses/${encodeURIComponent(course.id)}`
  const href = `${courseHref}/assignments/${encodeURIComponent(assignment.id)}`
  const date = (d: Date) => formatSessionDate(d, locale, config.timeZone)
  const isDraft = assignment.status === 'draft'
  const num = (n: number) => formatDecimal(n, locale)

  const submitted = rows.filter((r) => r.state !== 'missing')
  const graded = submitted.filter((r) => r.graded).length
  const counts = {
    submitted: rows.filter((r) => r.state === 'submitted').length,
    late: rows.filter((r) => r.state === 'late').length,
    missing: rows.filter((r) => r.state === 'missing').length,
  }

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={assignment.title}
        description={`${course.title} · ${course.className}`}
        actions={
          <>
            <Link href={`${href}/edit`} className={buttonVariants({ variant: 'outline' })}>
              <Pencil aria-hidden="true" data-icon="inline-start" />
              {t('detail.edit')}
            </Link>
            <Link href={`${courseHref}/assignments`} className={buttonVariants({ variant: 'outline' })}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('allAssignments')}
            </Link>
          </>
        }
      />
      <div className="-mt-5 flex flex-wrap gap-2">
        <Badge variant={isDraft ? 'outline' : 'secondary'}>{isDraft ? t('draft') : t('published')}</Badge>
        {assignment.gradesReleasedAt && <Badge variant="secondary">{t('gradesReleased')}</Badge>}
      </div>

      <Panel className="flex flex-col gap-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Fact label={t('detail.due')} className="col-span-2 sm:col-span-1">
            {date(assignment.dueAt)}
            <span className="block text-xs text-muted-foreground">{config.timeZone}</span>
          </Fact>
          <Fact label={t('detail.maxMark')}>
            <span className="font-mono">{num(assignment.maxMark)}</span>
          </Fact>
          <Fact label={t('detail.weight')}>
            <span className="font-mono">{num(assignment.weight)}</span>
          </Fact>
          <Fact label={t('detail.submissionMode')}>{t(`form.mode.${assignment.submissionMode}`)}</Fact>
          <Fact label={t('detail.latePolicy')}>{t(`form.late.${assignment.latePolicy}`)}</Fact>
        </dl>
        <div className="flex flex-wrap items-center gap-2.5 border-t pt-5">
          {isDraft ? (
            <>
              <p className="w-full text-sm text-muted-foreground">{t('detail.draftHint')}</p>
              <PublishButton assignmentId={assignment.id} rosterSize={rows.length} />
              <DeleteDraftButton assignmentId={assignment.id} courseId={course.id} />
            </>
          ) : assignment.gradesReleasedAt ? (
            <p className="text-sm text-muted-foreground">
              {t('detail.releasedOn', { date: date(assignment.gradesReleasedAt) })}
            </p>
          ) : (
            <>
              <p className="w-full text-sm text-muted-foreground">
                {t('detail.gradedCount', { graded, total: submitted.length })}
              </p>
              <ReleaseGradesButton
                assignmentId={assignment.id}
                graded={graded}
                ungraded={submitted.length - graded}
                beforeDeadline={assignment.dueAt.getTime() > now.getTime()}
              />
            </>
          )}
        </div>
      </Panel>

      <section aria-labelledby="assignment-instructions" className="flex flex-col gap-4">
        <SectionHeading id="assignment-instructions">{t('detail.instructions')}</SectionHeading>
        {isRichTextEmpty(assignment.instructions) ? (
          <p className="text-muted-foreground">{t('detail.noInstructions')}</p>
        ) : (
          <Panel>
            <RichTextView value={assignment.instructions} locale={locale} />
          </Panel>
        )}
        {assignment.attachments.length > 0 && (
          <FileList
            files={assignment.attachments}
            locale={locale}
            openLabel={(name) => t('detail.openFile', { name })}
          />
        )}
      </section>

      <section aria-labelledby="assignment-submissions" className="flex flex-col gap-4">
        <SectionHeading id="assignment-submissions">
          {t('detail.submissions')}
          {!isDraft && ` · ${t('counts', counts)}`}
        </SectionHeading>
        {isDraft ? (
          <p className="text-muted-foreground">{t('detail.submissionsAfterPublish')}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">{t('detail.noStudents')}</p>
        ) : (
          <div className="overflow-hidden rounded-3xl border">
            <Table>
              <TableCaption className="sr-only">{t('detail.tableCaption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="px-4">
                    {t('detail.student')}
                  </TableHead>
                  <TableHead scope="col">{t('detail.state')}</TableHead>
                  <TableHead scope="col">{t('detail.submittedAt')}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {t('detail.mark')}
                  </TableHead>
                  <TableHead scope="col" className="w-10">
                    <span className="sr-only">{t('detail.open')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.studentId}>
                    <TableHead scope="row" className="px-4 font-normal">
                      <span className="flex flex-col">
                        <span className="max-w-48 truncate font-medium">{row.name}</span>
                        {row.matricule && (
                          <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">
                            {row.matricule}
                          </span>
                        )}
                      </span>
                    </TableHead>
                    <TableCell>
                      <Badge variant={row.state === 'missing' ? 'outline' : row.state === 'late' ? 'destructive' : 'secondary'}>
                        {t(`state.${row.state}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.submittedAt ? date(row.submittedAt) : '—'}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">
                      {row.mark !== null ? `${num(row.mark)} / ${num(assignment.maxMark)}` : '—'}
                    </TableCell>
                    <TableCell>
                      {row.submissionId && (
                        <Link
                          href={`${href}/submissions/${encodeURIComponent(row.submissionId)}`}
                          aria-label={t('detail.openSubmission', { name: row.name })}
                          title={t('detail.openSubmission', { name: row.name })}
                          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                        >
                          <ChevronRight aria-hidden="true" />
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  )
}

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <dt className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
