import type { Locale } from '@/server/core/context'
import { NotificationLayout } from './notification-layout'
import { emailTranslator } from './verify-email'

export type ClassJoinedEmailProps = {
  locale: Locale
  studentName: string
  className: string
  schoolName: string
  /** `<BETTER_AUTH_URL>/dashboard`, where the class's courses show. */
  url: string
}

/** To a student who has just joined a class with its student code. */
export function ClassJoinedEmail({ locale, studentName, className, schoolName, url }: ClassJoinedEmailProps) {
  const e = emailTranslator(locale)
  const vars = { class: className, school: schoolName }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('classJoined.preview', vars)}
      greeting={e('classJoined.greeting', { name: studentName })}
      paragraphs={[e('classJoined.body', vars), e('classJoined.next')]}
      cta={e('classJoined.cta')}
      url={url}
      fallback={e('classJoined.fallback')}
    />
  )
}
