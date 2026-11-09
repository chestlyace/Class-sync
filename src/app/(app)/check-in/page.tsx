import { ArrowRight, Clock, Info } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locale'
import { getCheckInLinkTarget, listOpenCheckIns } from '@/server/attendance/check-in'
import { CHECK_IN_LINK_PARAM } from '@/server/attendance/link'
import { STUDENT_POLL_MS } from '@/server/attendance/rules'
import { getSessionUser } from '@/server/auth/session'
import { config } from '@/server/core/config'
import { isVerificationPending } from '@/server/core/guards'
import { formatSessionDate } from '../courses/attendance-format'
import { loadPage } from '../load-page'
import { AutoRefresh } from './auto-refresh'
import { CheckInForm } from './check-in-form'

export async function generateMetadata() {
  const t = await getTranslations('attendance.student')
  return { title: t('title') }
}

export default async function CheckInPage({ searchParams }: PageProps<'/check-in'>) {
  const user = await getSessionUser()
  if (!user || isVerificationPending(user)) return null // the layout shows the verification banner
  const [t, rawLocale] = await Promise.all([getTranslations('attendance.student'), getLocale()])
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const token = (await searchParams)[CHECK_IN_LINK_PARAM]
  if (typeof token === 'string' && token) {
    return <LinkCheckIn token={token} lecturer={user.role === 'lecturer'} locale={locale} />
  }
  const open = await loadPage((ctx) => listOpenCheckIns(ctx))
  if (!open.ok) return <ErrorState code={open.code} />

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AutoRefresh intervalMs={STUDENT_POLL_MS} />
      {open.data.length === 0 ? (
        <Panel className="flex flex-col items-start gap-2">
          <h2 className="text-lg font-semibold">{t('emptyTitle')}</h2>
          <p className="text-muted-foreground">{t('emptyBody')}</p>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-4">
          {open.data.map((c) => (
            <li key={c.windowId}>
              <Panel className="flex max-w-xl flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">
                      <Link
                        href={`/courses/${encodeURIComponent(c.courseId)}`}
                        className="outline-none hover:text-primary focus-visible:underline"
                      >
                        {c.courseTitle}
                      </Link>
                    </h2>
                    <Badge variant="secondary">{c.kind === 'start' ? t('kindStart') : t('kindEnd')}</Badge>
                  </div>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock aria-hidden="true" className="size-4" />
                    {t('closesAt', { time: formatSessionDate(c.closesAt, locale, config.timeZone, 'time') })}
                  </p>
                </div>
                <CheckInForm windowId={c.windowId} requireOnCampus={c.requireOnCampus} checkedIn={c.checkedIn} />
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** A calm message panel with a way on: used for every link that cannot be used. */
function LinkMessage({ title, body, action }: { title: string; body: string; action: string }) {
  return (
    <Panel role="alert" className="flex max-w-xl flex-col items-start gap-4">
      <Info aria-hidden="true" className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{body}</p>
      </div>
      <Link href="/check-in" className={buttonVariants({ variant: 'outline' })}>
        {action}
        <ArrowRight aria-hidden="true" data-icon="inline-end" />
      </Link>
    </Panel>
  )
}

/**
 * Opened from a lecturer's check-in link (`/check-in?w=…`): that one window, checked in with one
 * tap while it is open (location still asked when the session requires it).
 */
async function LinkCheckIn({ token, lecturer, locale }: { token: string; lecturer: boolean; locale: Locale }) {
  const t = await getTranslations('attendance.student')
  const action = t('link.allCheckIns')
  if (lecturer) return <LinkMessage title={t('link.lecturerTitle')} body={t('link.lecturerBody')} action={action} />
  const target = await loadPage((ctx) => getCheckInLinkTarget(ctx, token))
  if (!target.ok) {
    if (target.code === 'NOT_FOUND') {
      return <LinkMessage title={t('link.invalidTitle')} body={t('link.invalid')} action={action} />
    }
    if (target.code === 'FORBIDDEN') {
      return <LinkMessage title={t('link.forbiddenTitle')} body={t('forbidden')} action={action} />
    }
    return <ErrorState code={target.code} />
  }
  const c = target.data
  if (!c.open && !c.checkedIn) {
    const title = t('link.closedTitle', { course: c.courseTitle })
    return <LinkMessage title={title} body={t('link.closedBody')} action={action} />
  }
  return (
    <>
      <PageHeader
        eyebrow={c.kind === 'start' ? t('kindStart') : t('kindEnd')}
        title={c.courseTitle}
        description={t('link.description')}
      />
      <Panel className="flex max-w-xl flex-col gap-5">
        {c.open && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock aria-hidden="true" className="size-4" />
            {t('closesAt', { time: formatSessionDate(c.closesAt, locale, config.timeZone, 'time') })}
          </p>
        )}
        <CheckInForm
          windowId={c.windowId}
          requireOnCampus={c.requireOnCampus}
          checkedIn={c.checkedIn}
          linkToken={token}
        />
      </Panel>
    </>
  )
}
