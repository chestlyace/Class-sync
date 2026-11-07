import type { Locale } from '@/server/core/context'
import { NotificationLayout, formatDue } from './notification-layout'
import { emailTranslator } from './verify-email'

export type AssignmentPublishedEmailProps = {
  locale: Locale
  studentName: string
  courseTitle: string
  assignmentTitle: string
  dueAt: Date
  url: string
  timeZone: string
}

export function AssignmentPublishedEmail({ locale, studentName, courseTitle, assignmentTitle, dueAt, url, timeZone }: AssignmentPublishedEmailProps) {
  const e = emailTranslator(locale)
  const { date, time } = formatDue(dueAt, locale, timeZone)
  const vars = { course: courseTitle, assignment: assignmentTitle, date, time }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('assignmentPublished.preview', vars)}
      greeting={e('assignmentPublished.greeting', { name: studentName })}
      paragraphs={[e('assignmentPublished.body', vars), e('assignmentPublished.due', vars)]}
      cta={e('assignmentPublished.cta')}
      url={url}
      fallback={e('assignmentPublished.fallback')}
    />
  )
}
