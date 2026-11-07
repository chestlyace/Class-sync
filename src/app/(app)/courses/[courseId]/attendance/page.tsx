import { ArrowLeft, PenLine } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getAttendanceGrid, type GridRow, type GridSession } from '@/server/attendance/reports'
import type { AttendanceStatus } from '@/server/attendance/status'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { config } from '@/server/core/config'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { getSchool } from '@/server/schools/service'
import { loadPage } from '../../../load-page'
import { NewSessionForm } from '../../attendance-controls'
import { formatSessionDate } from '../../attendance-format'

type GridView = {
  course: CourseSummary
  sessions: GridSession[]
  rows: GridRow[]
  hasCampusLocation: boolean
}

export async function generateMetadata() {
  const t = await getTranslations('attendance.lecturer')
  return { title: t('gridTitle') }
}

export default async function AttendanceGridPage({ params }: PageProps<'/courses/[courseId]/attendance'>) {
  const { courseId } = await params
  const t = await getTranslations('attendance.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<GridView>(async (ctx) => {
    const grid = await getAttendanceGrid(ctx, courseId) // FORBIDDEN unless I teach this course
    const course = await getCourse(ctx, courseId)
    const school = await getSchool(ctx, course.schoolId)
    return { course, ...grid, hasCampusLocation: school.latitude !== null && school.longitude !== null }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, sessions, rows, hasCampusLocation } = view.data
  const courseHref = `/courses/${encodeURIComponent(course.id)}`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('gridTitle')}
        description={`${course.title} · ${course.className}`}
        actions={
          <Link href={courseHref} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {course.title}
          </Link>
        }
      />

      <section aria-labelledby="new-session" className="flex flex-col gap-4">
        <SectionHeading id="new-session">{t('newSession')}</SectionHeading>
        <Panel>
          <NewSessionForm courseId={course.id} hasCampusLocation={hasCampusLocation} />
        </Panel>
      </section>

      <section aria-labelledby="sessions" className="flex flex-col gap-4">
        <SectionHeading id="sessions">
          {t('sessionsTitle')} · {t('sessionCount', { count: sessions.length })}
        </SectionHeading>
        {sessions.length === 0 ? (
          <p className="text-muted-foreground">{t('noSessions')}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">{t('noStudents')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* The table scrolls inside its own container; the page never scrolls sideways. */}
            <div className="overflow-hidden rounded-3xl border">
              <Table>
                <TableCaption className="sr-only">{t('gridCaption')}</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col" className="sticky left-0 z-10 bg-card px-4">
                      {t('student')}
                    </TableHead>
                    {sessions.map((s) => {
                      const date = formatSessionDate(s.createdAt, locale, config.timeZone, 'short')
                      return (
                        <TableHead key={s.id} scope="col" className="text-center">
                          <Link
                            href={`${courseHref}/attendance/${encodeURIComponent(s.id)}`}
                            aria-label={t('openSessionLabel', { date })}
                            className="font-mono text-xs tracking-[0.04em] text-primary underline-offset-4 hover:underline"
                          >
                            {date}
                          </Link>
                        </TableHead>
                      )
                    })}
                    {(['present', 'partial', 'absent'] as const).map((status) => (
                      <TableHead key={status} scope="col" className="text-center">
                        <abbr title={t(`status.${status}`)} className="no-underline">
                          <span aria-hidden="true">{t(`statusShort.${status}`)}</span>
                          <span className="sr-only">
                            {t('totals')} · {t(`status.${status}`)}
                          </span>
                        </abbr>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.studentId}>
                      <TableHead scope="row" className="sticky left-0 z-10 bg-card px-4 font-normal">
                        <span className="flex flex-col">
                          <span className="max-w-48 truncate font-medium">{row.name}</span>
                          <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">
                            {row.matricule}
                          </span>
                        </span>
                      </TableHead>
                      {sessions.map((s) => (
                        <TableCell key={s.id} className="text-center">
                          <StatusMark
                            status={row.statuses[s.id] ?? null}
                            overridden={row.overridden[s.id] ?? false}
                            short={(key) => t(`statusShort.${key}`)}
                            full={(key) => t(`status.${key}`)}
                            overriddenLabel={t('overriddenLabel')}
                          />
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-mono">{row.totals.present}</TableCell>
                      <TableCell className="text-center font-mono">{row.totals.partial}</TableCell>
                      <TableCell className="text-center font-mono">{row.totals.absent}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-sm text-muted-foreground">{t('legend')}</p>
          </div>
        )}
      </section>
    </>
  )
}

type StatusKey = AttendanceStatus | 'none'

/** Short status (P / ½ / A / — / N/E) whose accessible name is the full word. */
function StatusMark({
  status,
  overridden,
  short,
  full,
  overriddenLabel,
}: {
  status: AttendanceStatus | null
  overridden: boolean
  short: (key: StatusKey) => string
  full: (key: StatusKey) => string
  overriddenLabel: string
}) {
  const key: StatusKey = status ?? 'none'
  const label = overridden ? `${full(key)} (${overriddenLabel})` : full(key)
  return (
    <span title={label} className="inline-flex items-center gap-1">
      <span aria-hidden="true" className={status === 'absent' ? 'font-semibold text-destructive' : 'font-semibold'}>
        {short(key)}
      </span>
      {overridden && <PenLine aria-hidden="true" className="size-3 text-muted-foreground" />}
      <span className="sr-only">{label}</span>
    </span>
  )
}
