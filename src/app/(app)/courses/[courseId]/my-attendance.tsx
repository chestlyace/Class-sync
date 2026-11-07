import { getLocale, getTranslations } from 'next-intl/server'
import { ErrorCodeMessage } from '@/components/action-error'
import { SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { getMyAttendance } from '@/server/attendance/reports'
import type { AttendanceStatus } from '@/server/attendance/status'
import { config } from '@/server/core/config'
import { loadPage } from '../../load-page'

const BADGE: Record<'present' | 'partial' | 'absent', 'default' | 'outline' | 'destructive'> = {
  present: 'default',
  partial: 'outline',
  absent: 'destructive',
}

/** The signed-in student's own attendance on a course: totals, then each session, newest first. */
export async function MyAttendance({ courseId }: { courseId: string }) {
  const [t, locale] = await Promise.all([getTranslations('attendance.student'), getLocale()])
  const result = await loadPage((ctx) => getMyAttendance(ctx, courseId))
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timeZone })

  return (
    <section aria-labelledby="my-attendance" className="flex flex-col gap-4">
      <SectionHeading id="my-attendance">{t('myAttendance')}</SectionHeading>
      {!result.ok ? (
        <p role="alert" className="text-sm text-destructive">
          <ErrorCodeMessage code={result.code} />
        </p>
      ) : result.data.entries.length === 0 ? (
        <p className="text-muted-foreground">{t('noSessions')}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 sm:max-w-md">
            {(['present', 'partial', 'absent'] as const).map((status) => (
              <div key={status} className="flex flex-col gap-1 rounded-2xl border px-4 py-3">
                <dt className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
                  {t(`status.${status}`)}
                </dt>
                <dd className="font-display text-4xl leading-none">{result.data.totals[status]}</dd>
              </div>
            ))}
          </dl>
          <ul aria-label={t('sessions')} className="flex flex-col divide-y rounded-3xl border">
            {result.data.entries.map((entry) => (
              <li
                key={entry.sessionId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
              >
                <span>{date.format(entry.createdAt)}</span>
                <StatusLabel status={entry.status} label={t(`status.${entry.status ?? 'none'}`)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function StatusLabel({ status, label }: { status: AttendanceStatus | null; label: string }) {
  if (status === 'present' || status === 'partial' || status === 'absent') {
    return <Badge variant={BADGE[status]}>{label}</Badge>
  }
  return <span className="text-sm text-muted-foreground">{label}</span>
}
