import type { Locale } from '@/server/core/context'
import { NotificationLayout } from './notification-layout'
import { emailTranslator } from './verify-email'

export type TestResultsReleasedEmailProps = {
  locale: Locale
  studentName: string
  courseTitle: string
  testTitle: string
  /** The test's own link, `<BETTER_AUTH_URL>/t/<code>`, where the released result shows. */
  url: string
}

export function TestResultsReleasedEmail({ locale, studentName, courseTitle, testTitle, url }: TestResultsReleasedEmailProps) {
  const e = emailTranslator(locale)
  const vars = { course: courseTitle, test: testTitle }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('testResultsReleased.preview', vars)}
      greeting={e('testResultsReleased.greeting', { name: studentName })}
      paragraphs={[e('testResultsReleased.body', vars)]}
      cta={e('testResultsReleased.cta')}
      url={url}
      fallback={e('testResultsReleased.fallback')}
    />
  )
}
