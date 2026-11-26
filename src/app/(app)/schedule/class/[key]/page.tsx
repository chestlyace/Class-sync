import { ArrowLeft, ArrowRight, Clock, ExternalLink, MapPin } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { cn } from '@/lib/utils'
import { config } from '@/server/core/config'
import { classroomOption } from '@/server/schedule/classroom'
import { getClassSitting } from '@/server/schedule/views'
import { loadPage } from '../../../load-page'
import { MoveOnlineButton } from '../../move-online-form'
import { OpenCheckInButton } from '../../schedule-controls'
import { formatDay, formatTime } from '../../schedule-format'

export async function generateMetadata() {
  const t = await getTranslations('schedule.classPage')
  return { title: t('eyebrow') }
}

/** Route params arrive decoded; a key that still looks encoded (old links) is decoded once more. */
function sittingKeyOf(raw: string): string {
  if (!raw.includes('%')) return raw
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The class a reminder points at: when and where, and one button that opens check-in. */
export default async function ClassPage({ params }: PageProps<'/schedule/class/[key]'>) {
  const { key } = await params
  const sittingKey = sittingKeyOf(key)
  const t = await getTranslations('schedule.classPage')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage(async (ctx) => {
    const found = await getClassSitting(ctx, sittingKey) // FORBIDDEN unless my class
    return { ...found, classroom: await classroomOption(ctx, found.course.id) }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { sitting, course, room, sessionId, meetingUrl, movableOccurrence, classroom } = view.data
  const time = `${formatTime(sitting.startsAt, config.timeZone)}–${formatTime(sitting.endsAt, config.timeZone)}`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={course.title}
        description={`${course.className} · ${course.schoolName}`}
        actions={
          <Link href="/schedule" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('toSchedule')}
          </Link>
        }
      />

      <Panel className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-3 text-lg font-medium">
            <Clock aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
            {t('when', { day: formatDay(sitting.date, locale, 'long'), time })}
          </p>
          <p className={cn('flex items-start gap-3', room ? 'text-lg font-medium' : 'text-muted-foreground')}>
            <MapPin aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
            {room ? t('room', { room }) : t('noRoom')}
          </p>
          {meetingUrl && (
            <div className="flex flex-col gap-3 rounded-2xl border bg-muted/40 p-4">
              <span className="text-sm font-medium">{t('meetingLink')}</span>
              <span className="min-w-0 break-all font-mono text-sm">{meetingUrl}</span>
              <div className="flex flex-wrap gap-2">
                <a
                  href={meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ size: 'lg' })}
                >
                  <ExternalLink aria-hidden="true" data-icon="inline-start" />
                  {t('openLink')}
                </a>
                <CopyButton value={meetingUrl} label={t('copyLink')} text={t('copyLink')} variant="outline" />
              </div>
            </div>
          )}
          {movableOccurrence && (
            <MoveOnlineButton
              occurrenceKey={movableOccurrence.key}
              when={`${formatDay(sitting.date, locale, 'medium')} · ${time}`}
              classroom={classroom}
            />
          )}
        </div>

        {sitting.status === 'missed' && <p className="text-muted-foreground">{t('missed')}</p>}

        {sessionId ? (
          <Link
            href={`/courses/${encodeURIComponent(course.id)}/attendance/${encodeURIComponent(sessionId)}`}
            className={buttonVariants({ size: 'lg', className: 'self-start' })}
          >
            {t('goToAttendance')}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        ) : (
          <div className="flex flex-col gap-2">
            <OpenCheckInButton sittingKey={sitting.key} size="lg" />
            <p className="text-sm text-muted-foreground">{t('checkInHint')}</p>
          </div>
        )}
      </Panel>
    </>
  )
}
