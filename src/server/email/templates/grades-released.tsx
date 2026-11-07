import type { Locale } from '@/server/core/context'
import { NotificationLayout } from './notification-layout'
import { emailTranslator } from './verify-email'

export type GradesReleasedEmailProps = {
  locale: Locale
  studentName: string
  courseTitle: string
  assignmentTitle: string
  url: string
}

export function GradesReleasedEmail({ locale, studentName, courseTitle, assignmentTitle, url }: GradesReleasedEmailProps) {
  const e = emailTranslator(locale)
  const vars = { course: courseTitle, assignment: assignmentTitle }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('gradesReleased.preview', vars)}
      greeting={e('gradesReleased.greeting', { name: studentName })}
      paragraphs={[e('gradesReleased.body', vars)]}
      cta={e('gradesReleased.cta')}
      url={url}
      fallback={e('gradesReleased.fallback')}
    />
  )
}
