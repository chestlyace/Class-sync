import { Clock } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { listOpenCheckIns } from '@/server/attendance/check-in'
import { STUDENT_POLL_MS } from '@/server/attendance/rules'
import { getSessionUser } from '@/server/auth/session'
import { config } from '@/server/core/config'
import { isVerificationPending } from '@/server/core/guards'
import { loadPage } from '../load-page'
import { AutoRefresh } from './auto-refresh'
import { CheckInForm } from './check-in-form'

export async function generateMetadata() {
  const t = await getTranslations('attendance.student')
  return { title: t('title') }
}

export default async function CheckInPage() {
  const user = await getSessionUser()
  if (!user || isVerificationPending(user)) return null // the layout shows the verification banner
  const [t, locale] = await Promise.all([getTranslations('attendance.student'), getLocale()])
  const open = await loadPage((ctx) => listOpenCheckIns(ctx))
  if (!open.ok) return <ErrorState code={open.code} />

  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: config.timeZone })

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
                    {t('closesAt', { time: time.format(c.closesAt) })}
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
