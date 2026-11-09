import type { Locale } from '@/server/core/context'
import { NotificationLayout } from './notification-layout'
import { emailTranslator } from './verify-email'

export type LecturerJoinedClassEmailProps = {
  locale: Locale
  lecturerName: string
  className: string
  schoolName: string
  /** `<BETTER_AUTH_URL>/classes/<id>`. */
  url: string
}

/** To a lecturer who has just joined a class with its lecturer code. */
export function LecturerJoinedClassEmail({ locale, lecturerName, className, schoolName, url }: LecturerJoinedClassEmailProps) {
  const e = emailTranslator(locale)
  const vars = { class: className, school: schoolName }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('lecturerJoinedClass.preview', vars)}
      greeting={e('lecturerJoinedClass.greeting', { name: lecturerName })}
      paragraphs={[e('lecturerJoinedClass.body', vars), e('lecturerJoinedClass.next')]}
      cta={e('lecturerJoinedClass.cta')}
      url={url}
      fallback={e('lecturerJoinedClass.fallback')}
    />
  )
}

export type ColleagueJoinedClassEmailProps = {
  locale: Locale
  recipientName: string
  colleagueName: string
  className: string
  schoolName: string
  /** `<BETTER_AUTH_URL>/classes/<id>`. */
  url: string
}

/** To the class's other lecturers (its creator included) when a colleague joins with the lecturer code. */
export function ColleagueJoinedClassEmail({
  locale,
  recipientName,
  colleagueName,
  className,
  schoolName,
  url,
}: ColleagueJoinedClassEmailProps) {
  const e = emailTranslator(locale)
  const vars = { name: colleagueName, class: className, school: schoolName }
  return (
    <NotificationLayout
      locale={locale}
      preview={e('colleagueJoinedClass.preview', vars)}
      greeting={e('colleagueJoinedClass.greeting', { recipient: recipientName })}
      paragraphs={[e('colleagueJoinedClass.body', vars), e('colleagueJoinedClass.next')]}
      cta={e('colleagueJoinedClass.cta')}
      url={url}
      fallback={e('colleagueJoinedClass.fallback')}
    />
  )
}
