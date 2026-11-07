import type { Locale } from '@/server/core/context'
import { NotificationLayout, formatDue } from './notification-layout'
import { emailTranslator } from './verify-email'

export type AssignmentReminderEmailProps = {
  locale: Locale
  studentName: string
  courseTitle: string
  assignmentTitle: string
  dueAt: Date
  url: string
  timeZone: string
}

export function AssignmentReminderEmail({ locale, studentName, courseTitle, assignmentTitle, dueAt, url, timeZone }: AssignmentReminderEmailProps) {
  const e = emailTranslator(locale)
  const { date, time } = formatDue(dueAt, locale, timeZone)
  const vars = { course: courseTitle, assignment: assignmentTitle, date, time }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('assignmentReminder.preview', vars)}
      greeting={e('assignmentReminder.greeting', { name: studentName })}
      paragraphs={[e('assignmentReminder.body', vars), e('assignmentReminder.due', vars)]}
      cta={e('assignmentReminder.cta')}
      url={url}
      fallback={e('assignmentReminder.fallback')}
    />
  )
}
