import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locale'
import { cn } from '@/lib/utils'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { listLecturerCourses, type CourseSummary } from '@/server/courses/service'
import { addDays, localDateOf, weekStartOf } from '@/server/lib/local-time'
import { listSlots } from '@/server/schedule/timetable'
import { lecturerWeek, needsAnswer, type WeekRow } from '@/server/schedule/views'
import type { Sitting } from '@/server/schedule/occurrences'
import { loadPage } from '../load-page'
import { MakeUpButton, type CourseOption } from './make-up-form'
import { RowBadge } from './row-badge'
import { NeedsAnswerList, RowActions, type NeedsAnswerItem } from './schedule-controls'
import { parseWeekParam } from './schedule-form'
import { formatDay, formatTime, formatWeekRange, weekBounds } from './schedule-format'

type ScheduleView = {
  courses: CourseSummary[]
  rows: WeekRow[]
  answers: { sitting: Sitting; courseTitle: string }[]
  /** False only when the week is empty and no course has a weekly class yet. */
  hasSlots: boolean
}

export async function generateMetadata() {
  const t = await getTranslations('schedule')
  return { title: t('title') }
}

export default async function SchedulePage({ searchParams }: PageProps<'/schedule'>) {
  const { week } = await searchParams
  const t = await getTranslations('schedule')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const at = now()
  const today = localDateOf(at, config.timeZone)
  const weekStart = parseWeekParam(week, today) // always a Monday
  const view = await loadPage<ScheduleView>(async (ctx) => {
    const courses = await listLecturerCourses(ctx) // FORBIDDEN for students
    const [rows, answers] = await Promise.all([lecturerWeek(ctx, weekStart), needsAnswer(ctx)])
    let hasSlots = true
    if (rows.length === 0) {
      const slots = await Promise.all(courses.map((c) => listSlots(ctx, c.id)))
      hasSlots = slots.some((s) => s.length > 0)
    }
    return { courses, rows, answers, hasSlots }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { courses, rows, answers, hasSlots } = view.data

  const currentWeek = weekStartOf(today)
  const range = formatWeekRange(weekStart, addDays(weekStart, 6), locale)
  const weekLabel =
    weekStart === currentWeek
      ? t('thisWeek', { range })
      : weekStart === addDays(currentWeek, 7)
        ? t('nextWeek', { range })
        : weekStart === addDays(currentWeek, -7)
          ? t('lastWeek', { range })
          : t('otherWeek', weekBounds(weekStart, addDays(weekStart, 6), locale))
  const weekHref = (start: string) => `/schedule?week=${start}`
  const span = (from: Date, to: Date) => `${formatTime(from, config.timeZone)}–${formatTime(to, config.timeZone)}`

  const courseOptions: CourseOption[] = courses.map((c) => ({
    id: c.id,
    title: c.title,
    className: c.className,
    schoolName: c.schoolName,
  }))
  const days = groupByDay(rows)
  const items: NeedsAnswerItem[] = answers.map(({ sitting, courseTitle }) => {
    const date = formatDay(sitting.date, locale, 'medium')
    return {
      sittingKey: sitting.key,
      courseId: sitting.courseId,
      label: t('needsAnswer.row', { date, time: span(sitting.startsAt, sitting.endsAt), course: courseTitle }),
      replacesLabel: t('makeUp.replaces', { course: courseTitle, date }),
      makeUpDefaults: {
        date: today,
        start: formatTime(sitting.startsAt, config.timeZone),
        end: formatTime(sitting.endsAt, config.timeZone),
        room: sitting.occurrences[0]?.room ?? '',
      },
    }
  })

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={courses.length > 0 ? <MakeUpButton courses={courseOptions} today={today} /> : undefined}
      />

      <section aria-labelledby="schedule-week" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="schedule-week" className="font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">
            {weekLabel}
          </h2>
          <div className="flex items-center gap-1.5">
            {weekStart !== currentWeek && (
              <Link href={weekHref(currentWeek)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                {t('backToThisWeek')}
              </Link>
            )}
            <Link
              href={weekHref(addDays(weekStart, -7))}
              aria-label={t('previousWeekLabel')}
              title={t('previousWeekLabel')}
              className={buttonVariants({ variant: 'outline', size: 'icon' })}
            >
              <ChevronLeft aria-hidden="true" />
            </Link>
            <Link
              href={weekHref(addDays(weekStart, 7))}
              aria-label={t('followingWeekLabel')}
              title={t('followingWeekLabel')}
              className={buttonVariants({ variant: 'outline', size: 'icon' })}
            >
              <ChevronRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        {rows.length > 0 ? (
          <ol className="flex flex-col divide-y rounded-3xl border">
            {days.map(([date, dayRows]) => (
              <li key={date} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:gap-6 sm:px-5">
                <h3
                  className={cn(
                    'shrink-0 font-mono text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase sm:w-20 sm:pt-0.5',
                    date === today && 'text-primary',
                  )}
                >
                  <time dateTime={date} aria-current={date === today ? 'date' : undefined}>
                    {formatDay(date, locale, 'short')}
                  </time>
                </h3>
                <ul className="flex min-w-0 flex-1 flex-col gap-4">
                  {dayRows.map((row) => (
                    <ClassRow key={row.occurrence.key} row={row} locale={locale} at={at} span={span} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : hasSlots ? (
          <p className="text-muted-foreground">{t('noClasses')}</p>
        ) : (
          <Panel className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold tracking-tight">{t('empty.title')}</h3>
              <p className="text-muted-foreground">{courses.length > 0 ? t('empty.body') : t('empty.noCourses')}</p>
            </div>
            {courses.length > 0 && (
              <ul className="flex flex-col gap-2">
                {courses.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/courses/${encodeURIComponent(c.id)}/timetable`}
                      className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t('empty.courseLink', { course: c.title, className: c.className })}
                      <ArrowRight aria-hidden="true" className="size-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </section>

      <NeedsAnswerList items={items} />
    </>
  )
}

/** Rows arrive sorted by start time; days keep that order. */
function groupByDay(rows: WeekRow[]): [string, WeekRow[]][] {
  const days = new Map<string, WeekRow[]>()
  for (const row of rows) {
    const list = days.get(row.occurrence.date)
    if (list) list.push(row)
    else days.set(row.occurrence.date, [row])
  }
  return [...days]
}

function ClassRow({
  row,
  locale,
  at,
  span,
}: {
  row: WeekRow
  locale: Locale
  at: Date
  span: (from: Date, to: Date) => string
}) {
  const { occurrence: occ } = row
  const time = span(occ.startsAt, occ.endsAt)
  const future = occ.startsAt.getTime() > at.getTime()
  const cancelled = row.badge === 'cancelled'
  // The room as the lecturer typed it (e.g. "B4"), with no label.
  const details = [row.className, row.schoolName, occ.room].filter(Boolean)

  return (
    <li className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className={cn('flex min-w-0 flex-col gap-1', cancelled && 'text-muted-foreground')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-sm tabular-nums">{time}</span>
          <span className="font-medium">{row.courseTitle}</span>
          {row.badge && <RowBadge badge={row.badge} replacesDate={row.replacesDate} locale={locale} />}
        </div>
        <span className="text-sm text-muted-foreground">{details.join(' · ')}</span>
      </div>
      <RowActions
        occurrenceKey={occ.key}
        sittingKey={row.sittingKey}
        canOpenCheckIn={row.canOpenCheckIn}
        canCancel={future && occ.status === null}
        canUndo={future && cancelled}
        courseTitle={row.courseTitle}
        when={`${formatDay(occ.date, locale, 'medium')} · ${time}`}
        makeUpDefaults={{
          date: occ.date,
          start: formatTime(occ.startsAt, config.timeZone),
          end: formatTime(occ.endsAt, config.timeZone),
          room: occ.room ?? '',
        }}
      />
    </li>
  )
}
