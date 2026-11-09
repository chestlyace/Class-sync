import { ArrowLeft, Check, Minus, PenLine, Trash2, X } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ConfirmAction } from '@/components/confirm-action'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  getCheckInLink,
  getLiveWindow,
  getSession,
  type LiveWindow as LiveWindowData,
  type WindowState,
} from '@/server/attendance/sessions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { isSessionOver, SESSION_MAX_HOURS } from '@/server/attendance/rules'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { AppError } from '@/server/core/errors'
import { absoluteLink } from '@/app/share-links'
import { loadPage } from '../../../../load-page'
import { deleteSessionAction, type LiveWindowView } from '../../../attendance-actions'
import { OpenWindowButton, OverrideSelect } from '../../../attendance-controls'
import { formatSessionDate } from '../../../attendance-format'
import { LiveWindow } from '../../../live-window'

type SessionView = Awaited<ReturnType<typeof getSession>> & { live: LiveWindowData | null; linkPath: string | null }

export async function generateMetadata() {
  const t = await getTranslations('attendance.lecturer')
  return { title: t('eyebrow') }
}

export default async function AttendanceSessionPage({
  params,
}: PageProps<'/courses/[courseId]/attendance/[sessionId]'>) {
  const { courseId, sessionId } = await params
  const t = await getTranslations('attendance.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<SessionView>(async (ctx) => {
    const data = await getSession(ctx, sessionId) // FORBIDDEN unless I teach this course
    if (data.session.courseId !== courseId) throw new AppError('NOT_FOUND', 'Session not in this course')
    const openWindow = data.session.windows.find((w) => w.open)
    if (!openWindow) return { ...data, live: null, linkPath: null }
    const [live, linkPath] = await Promise.all([getLiveWindow(ctx, openWindow.id), getCheckInLink(ctx, openWindow.id)])
    return { ...data, live, linkPath }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { session, course, students, live, linkPath } = view.data
  const checkInLink = linkPath ? await absoluteLink(linkPath) : null
  const gridHref = `/courses/${encodeURIComponent(course.id)}/attendance`
  const time = (date: Date) => formatSessionDate(date, locale, config.timeZone, 'time')

  const windowOf = (kind: 'start' | 'end') => session.windows.find((w) => w.kind === kind)
  const anyOpen = session.windows.some((w) => w.open)
  // The same rule openWindow enforces: no new check-in once the session is 12 h old.
  const over = isSessionOver(session.createdAt, now())
  const disabledReason = (kind: 'start' | 'end') => {
    if (over) return t('sessionOver', { hours: SESSION_MAX_HOURS })
    if (windowOf(kind)) return t('alreadyUsed')
    if (anyOpen) return t('otherOpenHere')
    return undefined
  }
  const describeCheck = (label: string, opened: boolean, checked: boolean) =>
    t('checkMark', { label, state: !opened ? t('notOpened') : checked ? t('checked') : t('notChecked') })
  const windowStateText = (w: WindowState | undefined) =>
    !w ? t('windowState.notOpened') : w.open ? t('windowState.open') : t('windowState.closed', { time: time(w.closesAt) })

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={formatSessionDate(session.createdAt, locale, config.timeZone)}
        description={course.title}
        actions={
          <Link href={gridHref} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('allSessions')}
          </Link>
        }
      />
      <div className="-mt-5 flex flex-wrap gap-2">
        <Badge variant={session.requireOnCampus ? 'secondary' : 'outline'}>
          {session.requireOnCampus ? t('campusRequired') : t('campusNotRequired')}
        </Badge>
      </div>

      <section aria-labelledby="check-in" className="flex flex-col gap-4">
        <SectionHeading id="check-in">{t('checkInTitle')}</SectionHeading>
        {live && (
          <LiveWindow key={live.windowId} initial={toView(live)} link={checkInLink} timeZone={config.timeZone} />
        )}
        <Panel className="grid gap-6 sm:grid-cols-2">
          {(['start', 'end'] as const).map((kind) => (
            <div key={kind} className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{t(`kind.${kind}`)}</span>
                <span className="text-sm text-muted-foreground">{windowStateText(windowOf(kind))}</span>
              </div>
              <OpenWindowButton sessionId={session.id} kind={kind} disabledReason={disabledReason(kind)} />
            </div>
          ))}
        </Panel>
      </section>

      <section aria-labelledby="session-students" className="flex flex-col gap-4">
        <SectionHeading id="session-students">{t('studentsTitle')}</SectionHeading>
        {students.length === 0 ? (
          <p className="text-muted-foreground">{t('noStudents')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-3xl border">
            {students.map((student) => {
              const statusKey = student.status ?? 'none'
              return (
                <li
                  key={student.studentId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 basis-48 flex-col">
                    <span className="truncate font-medium">{student.name}</span>
                    <span className="font-mono text-sm tracking-[0.04em] text-muted-foreground">
                      {student.matricule}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <CheckMark
                      label={t('start')}
                      opened={windowOf('start') !== undefined}
                      checked={student.checkedStart}
                      describe={describeCheck}
                    />
                    <CheckMark
                      label={t('end')}
                      opened={windowOf('end') !== undefined}
                      checked={student.checkedEnd}
                      describe={describeCheck}
                    />
                    <span className="inline-flex w-28 items-center gap-1 font-medium">
                      {t(`status.${statusKey}`)}
                      {student.override && (
                        <>
                          <PenLine aria-hidden="true" className="size-3 text-muted-foreground" />
                          <span className="sr-only">({t('overriddenLabel')})</span>
                        </>
                      )}
                    </span>
                  </div>
                  <OverrideSelect
                    key={student.studentId}
                    sessionId={session.id}
                    studentId={student.studentId}
                    name={student.name}
                    value={student.override ?? 'auto'}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="flex justify-end">
        <ConfirmAction
          action={deleteSessionAction.bind(null, session.id)}
          fields={{}}
          triggerLabel={t('deleteSession')}
          triggerIcon={<Trash2 aria-hidden="true" data-icon="inline-start" />}
          title={t('deleteTitle')}
          body={t('deleteBody')}
          confirmLabel={t('deleteConfirm')}
          destructive
        />
      </div>
    </>
  )
}

function toView(live: LiveWindowData): LiveWindowView {
  return { ...live, closesAt: live.closesAt.toISOString() }
}

/** "Start ✓" / "Start ✗" / "Start –" with the state spelled out for screen readers. */
function CheckMark({
  label,
  opened,
  checked,
  describe,
}: {
  label: string
  opened: boolean
  checked: boolean
  /** "Start: checked in" (in French "Début : a pointé"). */
  describe: (label: string, opened: boolean, checked: boolean) => string
}) {
  const description = describe(label, opened, checked)
  const Icon = !opened ? Minus : checked ? Check : X
  return (
    <span title={description} className="inline-flex items-center gap-1">
      <span aria-hidden="true" className="font-mono text-xs tracking-[0.04em] text-muted-foreground uppercase">
        {label}
      </span>
      <Icon
        aria-hidden="true"
        className={
          !opened ? 'size-4 text-muted-foreground' : checked ? 'size-4 text-foreground' : 'size-4 text-destructive'
        }
      />
      <span className="sr-only">{description}</span>
    </span>
  )
}
