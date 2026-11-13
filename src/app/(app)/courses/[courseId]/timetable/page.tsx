import { ArrowLeft, CalendarDays } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { now } from '@/server/core/clock'
import { config } from '@/server/core/config'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { addDays, localDateOf } from '@/server/lib/local-time'
import { listSlots, type SlotView } from '@/server/schedule/timetable'
import { getSchool } from '@/server/schools/service'
import { loadPage } from '../../../load-page'
import { formatDay, minutesToTime, weekdayName } from '../../../schedule/schedule-format'
import { TimetableEditor, type SlotFormValues, type SlotListItem } from './timetable-form'

type TimetableView = { course: CourseSummary; slots: SlotView[]; hasCampusLocation: boolean }

/** A new slot's term when the course has none to copy. */
const DEFAULT_TERM_DAYS = 120

export async function generateMetadata() {
  const t = await getTranslations('schedule.timetable')
  return { title: t('title') }
}

/** The term a new slot starts with: the course's latest slot's (the one ending last), else today + 120 days. */
function defaultTerm(slots: SlotView[], today: string): { startsOn: string; endsOn: string } {
  const latest = slots.reduce<SlotView | null>(
    (best, s) =>
      !best || s.endsOn > best.endsOn || (s.endsOn === best.endsOn && s.startsOn < best.startsOn) ? s : best,
    null,
  )
  return latest
    ? { startsOn: latest.startsOn, endsOn: latest.endsOn }
    : { startsOn: today, endsOn: addDays(today, DEFAULT_TERM_DAYS) }
}

export default async function TimetablePage({ params }: PageProps<'/courses/[courseId]/timetable'>) {
  const { courseId } = await params
  const t = await getTranslations('schedule.timetable')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage<TimetableView>(async (ctx) => {
    const slots = await listSlots(ctx, courseId) // FORBIDDEN unless I teach this course
    const course = await getCourse(ctx, courseId)
    const school = await getSchool(ctx, course.schoolId)
    return { course, slots, hasCampusLocation: school.latitude !== null && school.longitude !== null }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, slots, hasCampusLocation } = view.data
  const today = localDateOf(now(), config.timeZone)

  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => weekdayName(d, locale))
  const items: SlotListItem[] = slots.map((s) => ({
    id: s.id,
    weekday: s.weekday,
    start: minutesToTime(s.startMinute),
    end: minutesToTime(s.endMinute),
    room: s.room ?? '',
    requireOnCampus: s.requireOnCampus,
    startsOn: s.startsOn,
    endsOn: s.endsOn,
    dayLabel: weekdays[s.weekday - 1],
    termLabel: t('term', { from: formatDay(s.startsOn, locale, 'date'), to: formatDay(s.endsOn, locale, 'date') }),
  }))
  const defaults: SlotFormValues = {
    weekday: 1,
    start: '',
    end: '',
    room: '',
    requireOnCampus: false,
    ...defaultTerm(slots, today),
  }
  const courseHref = `/courses/${encodeURIComponent(course.id)}`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('title')}
        description={`${course.title} · ${course.className} · ${course.schoolName}`}
        actions={
          <>
            <Link href={courseHref} className={buttonVariants({ variant: 'outline' })}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {course.title}
            </Link>
            <Link href="/schedule" className={buttonVariants({ variant: 'outline' })}>
              <CalendarDays aria-hidden="true" data-icon="inline-start" />
              {t('toSchedule')}
            </Link>
          </>
        }
      />
      <TimetableEditor
        courseId={course.id}
        slots={items}
        defaults={defaults}
        hasCampusLocation={hasCampusLocation}
        weekdays={weekdays}
      />
    </>
  )
}
