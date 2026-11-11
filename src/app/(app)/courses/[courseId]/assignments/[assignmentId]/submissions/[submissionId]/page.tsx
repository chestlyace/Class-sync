import { ArrowLeft, ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { RichTextView } from '@/components/rich-text-view'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { displayKind } from '@/lib/file-display'
import { formatFileSize } from '@/lib/file-size'
import {
  getSubmissionForLecturer,
  listSubmissions,
  type LecturerSubmissionView,
  type SubmissionRow,
} from '@/server/assignments/lecturer'
import { isRichTextEmpty } from '@/server/assignments/rich-text'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import type { FileInfo } from '@/server/files/service'
import { loadPage } from '../../../../../../load-page'
import { GradeForm } from '../../../../../assignment-controls'
import { formatSessionDate } from '../../../../../attendance-format'

type SubmissionPageView = LecturerSubmissionView & { rows: SubmissionRow[] }

export async function generateMetadata() {
  const t = await getTranslations('assignments.lecturer.submission')
  return { title: t('eyebrow') }
}

export default async function SubmissionPage({
  params,
}: PageProps<'/courses/[courseId]/assignments/[assignmentId]/submissions/[submissionId]'>) {
  const { courseId, assignmentId, submissionId } = await params
  const t = await getTranslations('assignments.lecturer.submission')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<SubmissionPageView>(async (ctx) => {
    const sub = await getSubmissionForLecturer(ctx, submissionId) // FORBIDDEN unless my course
    if (sub.assignment.id !== assignmentId || sub.assignment.courseId !== courseId) {
      throw new AppError('NOT_FOUND', 'Submission not in this assignment')
    }
    const { rows } = await listSubmissions(ctx, assignmentId)
    return { ...sub, rows }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { assignment, student, text, files, submittedAt, isLate, mark, feedback, suggestion, rows } = view.data
  const href = `/courses/${encodeURIComponent(assignment.courseId)}/assignments/${encodeURIComponent(assignment.id)}`

  // Previous / next submitted work, in roster order.
  const withWork = rows.filter((r) => r.submissionId !== null)
  const index = withWork.findIndex((r) => r.submissionId === submissionId)
  const previous = index > 0 ? withWork[index - 1] : undefined
  const next = index >= 0 && index < withWork.length - 1 ? withWork[index + 1] : undefined
  const submissionHref = (row: SubmissionRow) => `${href}/submissions/${encodeURIComponent(row.submissionId!)}`

  return (
    <>
      <PageHeader
        eyebrow={`${t('eyebrow')} · ${assignment.title}`}
        title={student.name}
        description={
          student.matricule && <span className="font-mono text-sm tracking-[0.04em]">{student.matricule}</span>
        }
        actions={
          <Link href={href} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('allSubmissions')}
          </Link>
        }
      />
      <div className="-mt-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{t('submittedAt', { date: formatSessionDate(submittedAt, locale, config.timeZone) })}</span>
        {isLate && <Badge variant="destructive">{t('late')}</Badge>}
      </div>

      {text && !isRichTextEmpty(text) && (
        <section aria-labelledby="submission-text" className="flex flex-col gap-4">
          <SectionHeading id="submission-text">{t('answer')}</SectionHeading>
          <Panel>
            <RichTextView value={text} locale={locale} />
          </Panel>
        </section>
      )}

      {files.length > 0 && (
        <section aria-labelledby="submission-files" className="flex flex-col gap-4">
          <SectionHeading id="submission-files">
            {t('files')} · {files.length}
          </SectionHeading>
          {files.map((f) => (
            <SubmittedFile
              key={f.id}
              file={f}
              locale={locale}
              linkText={displayKind(f.mimeType) === 'download' ? t('download') : t('openTab')}
              linkLabel={displayKind(f.mimeType) === 'download' ? t('downloadLabel', { name: f.name }) : t('open', { name: f.name })}
            />
          ))}
        </section>
      )}

      {(!text || isRichTextEmpty(text)) && files.length === 0 && <p className="text-muted-foreground">{t('nothing')}</p>}

      <section aria-labelledby="submission-grade" className="flex flex-col gap-4">
        <SectionHeading id="submission-grade">{t('grade')}</SectionHeading>
        <Panel>
          <GradeForm
            // A new version from the student starts a fresh form (its grade was cleared).
            key={`${submissionId}:${submittedAt.toISOString()}`}
            submissionId={submissionId}
            submittedAt={submittedAt.toISOString()}
            maxMark={assignment.maxMark}
            mark={mark}
            feedback={feedback}
            suggestion={suggestion && { mark: suggestion.mark, feedback: suggestion.feedback }}
          />
        </Panel>
      </section>

      <nav aria-label={t('navLabel')} className="flex flex-wrap justify-between gap-3">
        {previous ? (
          <Link href={submissionHref(previous)} className={buttonVariants({ variant: 'outline' })}>
            <ChevronLeft aria-hidden="true" data-icon="inline-start" />
            <span className="sr-only">{t('previous')}: </span>
            {previous.name}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={submissionHref(next)} className={buttonVariants({ variant: 'outline' })}>
            <span className="sr-only">{t('next')}: </span>
            {next.name}
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        )}
      </nav>
    </>
  )
}

/** PDFs and JPEG/PNG/WebP shown inline (served by /api/files with access checks); Word and HEIC as downloads. */
function SubmittedFile({
  file,
  locale,
  linkText,
  linkLabel,
}: {
  file: FileInfo
  locale: string
  linkText: string
  linkLabel: string
}) {
  const src = `/api/files/${encodeURIComponent(file.id)}`
  const kind = displayKind(file.mimeType)
  return (
    <figure className="flex flex-col gap-2">
      {kind === 'pdf' && <iframe src={src} title={file.name} className="h-[70vh] min-h-96 w-full rounded-2xl border bg-muted" />}
      {kind === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element -- private file behind an access-checked route
        <img src={src} alt={file.name} className="max-h-[80vh] w-auto max-w-full rounded-2xl border object-contain" />
      )}
      <figcaption className="flex items-center gap-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatFileSize(file.sizeBytes, locale)}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener"
          aria-label={linkLabel}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <Download aria-hidden="true" data-icon="inline-start" />
          {linkText}
        </a>
      </figcaption>
    </figure>
  )
}
