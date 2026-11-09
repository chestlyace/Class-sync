import type { Locale } from '@/server/core/context'
import { NotificationLayout, formatDue } from './notification-layout'
import { emailTranslator } from './verify-email'

export type TestHandedInEmailProps = {
  locale: Locale
  studentName: string
  courseTitle: string
  testTitle: string
  handedInAt: Date
  /** The test's own link, `<BETTER_AUTH_URL>/t/<code>`. */
  url: string
  timeZone: string
}

/** The student's receipt for handing in a test. Never any marks. */
export function TestHandedInEmail({ locale, studentName, courseTitle, testTitle, handedInAt, url, timeZone }: TestHandedInEmailProps) {
  const e = emailTranslator(locale)
  const { date, time } = formatDue(handedInAt, locale, timeZone)
  const vars = { course: courseTitle, test: testTitle }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('testHandedIn.preview', vars)}
      greeting={e('testHandedIn.greeting', { name: studentName })}
      paragraphs={[e('testHandedIn.body', vars), e('testHandedIn.at', { date, time }), e('testHandedIn.next')]}
      cta={e('testHandedIn.cta')}
      url={url}
      fallback={e('testHandedIn.fallback')}
    />
  )
}
