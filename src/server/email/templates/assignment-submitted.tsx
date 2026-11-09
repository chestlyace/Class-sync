import type { Locale } from '@/server/core/context'
import { NotificationLayout, formatDue } from './notification-layout'
import { emailTranslator } from './verify-email'

export type AssignmentSubmittedEmailProps = {
  locale: Locale
  studentName: string
  courseTitle: string
  assignmentTitle: string
  submittedAt: Date
  isLate: boolean
  url: string
  timeZone: string
}

/** The student's receipt for a submission (or a replacement of it). */
export function AssignmentSubmittedEmail({
  locale,
  studentName,
  courseTitle,
  assignmentTitle,
  submittedAt,
  isLate,
  url,
  timeZone,
}: AssignmentSubmittedEmailProps) {
  const e = emailTranslator(locale)
  const { date, time } = formatDue(submittedAt, locale, timeZone)
  const vars = { course: courseTitle, assignment: assignmentTitle }
  const paragraphs = [e('assignmentSubmitted.body', vars), e('assignmentSubmitted.at', { date, time })]
  if (isLate) paragraphs.push(e('assignmentSubmitted.late'))
  return (
    <NotificationLayout
      locale={locale}
      preview={e('assignmentSubmitted.preview', vars)}
      greeting={e('assignmentSubmitted.greeting', { name: studentName })}
      paragraphs={paragraphs}
      cta={e('assignmentSubmitted.cta')}
      url={url}
      fallback={e('assignmentSubmitted.fallback')}
    />
  )
}
