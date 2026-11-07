import { ArrowRight, KeyRound, Plus } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { listMyAssignments } from '@/server/assignments/student'
import { cn } from '@/lib/utils'
import { listOpenCheckIns } from '@/server/attendance/check-in'
import { getAttendanceGrid } from '@/server/attendance/reports'
import { getSessionUser } from '@/server/auth/session'
import { listMyClasses, type ClassSummary } from '@/server/classes/service'
import { config } from '@/server/core/config'
import type { Locale } from '@/server/core/context'
import { isVerificationPending } from '@/server/core/guards'
import { listLecturerCourses, listStudentCourses, type CourseSummary } from '@/server/courses/service'
import { toOpenCheckInView } from '../check-in/view'
import { formatSessionDate } from '../courses/attendance-format'
import { loadPage } from '../load-page'
import { lastSessionFigure, pickLikelyNow, type LastSession } from './attendance-summary'
import { orEmptyOnError } from './fallback'
import { groupDashboard } from './group'
import { DueSoon } from './due-soon'
import { OpenCheckIns } from './open-check-ins'

export async function generateMetadata() {
  const t = await getTranslations('dashboard')
  return { title: t('title') }
}

function intlLocale(locale: Locale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-GB'
}

export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) return null
  const t = await getTranslations('dashboard')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const pending = isVerificationPending(user)
  const isLecturer = user.role === 'lecturer'
  const now = new Date()

  const header = (
    <PageHeader
      eyebrow={
        isLecturer
          ? new Intl.DateTimeFormat(intlLocale(locale), {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: config.timeZone,
            }).format(now)
          : t('studentEyebrow')
      }
      title={t('greeting', { name: user.name.split(/\s+/)[0] || user.name })}
      // Unverified users get the layout's banner instead of create/join actions.
      actions={pending ? undefined : isLecturer ? <LecturerActions /> : <StudentActions />}
    />
  )
  if (pending) return header

  const data = await loadPage(async (ctx) => {
    const [classes, courses, openCheckIns, dueSoon] = await Promise.all([
      listMyClasses(ctx),
      isLecturer ? listLecturerCourses(ctx) : listStudentCourses(ctx),
      // A failing check-in list must not take the whole dashboard down: show it without.
      isLecturer ? [] : orEmptyOnError('open check-ins', () => listOpenCheckIns(ctx)),
      isLecturer ? [] : orEmptyOnError('assignments due soon', () => listMyAssignments(ctx, { dueWithinDays: 7 })),
    ])
    // Lecturers see last session's turnout per course. If it fails, the cards simply show none.
    const grids = isLecturer
      ? await orEmptyOnError('course attendance', () =>
          Promise.all(courses.map(async (c) => ({ courseId: c.id, ...(await getAttendanceGrid(ctx, c.id)) }))),
        )
      : []
    return { classes, courses, openCheckIns: openCheckIns.map(toOpenCheckInView), grids, dueSoon }
  })
  if (!data.ok) return <ErrorState code={data.code} />
  const { classes, courses, grids } = data.data
  const { schools, otherCourses } = groupDashboard(classes, courses)

  const lastSessions = new Map(grids.map((g) => [g.courseId, lastSessionFigure(g.sessions, g.rows)]))
  const likely = pickLikelyNow(
    grids.flatMap((g) => g.sessions.map((s) => ({ courseId: g.courseId, createdAt: s.createdAt }))),
    now,
  )
  const likelyCourse = likely && courses.find((c) => c.id === likely.courseId)

  if (schools.length === 0 && otherCourses.length === 0) {
    return (
      <>
        {header}
        <Panel className="flex flex-col items-start gap-2">
          <h2 className="text-lg font-semibold">{isLecturer ? t('lecturerEmptyTitle') : t('studentEmptyTitle')}</h2>
          <p className="text-muted-foreground">{isLecturer ? t('lecturerEmptyBody') : t('studentEmptyBody')}</p>
        </Panel>
      </>
    )
  }

  return (
    <>
      {header}
      {!isLecturer && <OpenCheckIns initial={data.data.openCheckIns} />}
      {!isLecturer && <DueSoon items={data.data.dueSoon} locale={locale} now={now} />}
      {likely && likelyCourse && (
        <LikelyNow
          course={likelyCourse}
          studentCount={classes.find((c) => c.id === likelyCourse.classId)?.studentCount}
          startedAt={likely.startedAt}
          locale={locale}
        />
      )}
      {schools.map((group) => (
        <section key={group.schoolId} aria-labelledby={`school-${group.schoolId}`} className="flex flex-col gap-7">
          <SectionHeading id={`school-${group.schoolId}`}>{group.schoolName}</SectionHeading>
          {group.classes.map(({ cls, courses }) => (
            <ClassBlock key={cls.id} cls={cls} courses={courses} isLecturer={isLecturer} lastSessions={lastSessions} />
          ))}
        </section>
      ))}
      {otherCourses.length > 0 && (
        <section aria-labelledby="other-courses" className="flex flex-col gap-4">
          <SectionHeading id="other-courses">{t('otherCourses')}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t('otherCoursesHint')}</p>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherCourses.map((course) => (
              <li key={course.id}>
                <CourseCard
                  course={course}
                  context={`${course.className} · ${course.schoolName}`}
                  isLecturer={isLecturer}
                  lastSession={lastSessions.get(course.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

async function LecturerActions() {
  const t = await getTranslations('dashboard')
  return (
    <>
      <Link href="/join" className={buttonVariants({ variant: 'outline' })}>
        <KeyRound aria-hidden="true" data-icon="inline-start" />
        {t('joinAsLecturer')}
      </Link>
      <Link href="/schools/new" className={buttonVariants({ variant: 'outline' })}>
        {t('newSchool')}
      </Link>
      <Link href="/classes/new" className={buttonVariants({ variant: 'outline' })}>
        {t('newClass')}
      </Link>
      <Link href="/courses/new" className={buttonVariants({ className: 'bg-foreground text-background hover:bg-foreground/85' })}>
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t('newCourse')}
      </Link>
    </>
  )
}

async function StudentActions() {
  const t = await getTranslations('dashboard')
  return (
    <Link href="/join" className={buttonVariants()}>
      <KeyRound aria-hidden="true" data-icon="inline-start" />
      {t('joinClass')}
    </Link>
  )
}

/** The class this lecturer probably teaches now, guessed from last week (there is no timetable). */
async function LikelyNow({
  course,
  studentCount,
  startedAt,
  locale,
}: {
  course: CourseSummary
  studentCount: number | undefined
  startedAt: Date
  locale: Locale
}) {
  const t = await getTranslations('dashboard')
  const weekday = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: config.timeZone }).format(
    startedAt,
  )
  const courseHref = `/courses/${encodeURIComponent(course.id)}`
  return (
    <section
      aria-labelledby="likely-now"
      className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border bg-card px-6 py-6 sm:px-8 sm:py-7"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <Eyebrow>{t('likelyNow', { weekday, time: formatSessionDate(startedAt, locale, config.timeZone, 'time') })}</Eyebrow>
        <h2 id="likely-now" className="text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-3xl">
          {course.title}
        </h2>
        <p className="text-muted-foreground">
          {studentCount === undefined
            ? `${course.className} · ${course.schoolName}`
            : t('likelyMeta', { className: course.className, schoolName: course.schoolName, count: studentCount })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href={courseHref} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          {t('openCourse')}
        </Link>
        <Link href={`${courseHref}/attendance`} className={buttonVariants({ size: 'lg', className: 'h-12 px-6 text-base' })}>
          {t('startCheckIn')}
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </div>
    </section>
  )
}

async function ClassBlock({
  cls,
  courses,
  isLecturer,
  lastSessions,
}: {
  cls: ClassSummary
  courses: CourseSummary[]
  isLecturer: boolean
  lastSessions: Map<string, LastSession | null>
}) {
  const t = await getTranslations('dashboard')
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-lg font-semibold">
          <Link href={`/classes/${encodeURIComponent(cls.id)}`} className="outline-none hover:text-primary focus-visible:underline">
            {cls.name}
          </Link>
        </h3>
        <span className="font-mono text-xs tracking-[0.06em] text-muted-foreground uppercase">
          {t('classMeta', { year: cls.academicYear, count: cls.studentCount })}
        </span>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <li key={course.id}>
            <CourseCard course={course} isLecturer={isLecturer} lastSession={lastSessions.get(course.id)} />
          </li>
        ))}
        {isLecturer && (
          <li>
            <Link
              href={`/courses/new?classId=${encodeURIComponent(cls.id)}`}
              className="flex h-full min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-input px-5 py-4 text-center font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Plus aria-hidden="true" className="size-5" />
              {t('addCourse')}
            </Link>
          </li>
        )}
      </ul>
      {!isLecturer && courses.length === 0 && <p className="text-sm text-muted-foreground">{t('noCourses')}</p>}
    </div>
  )
}

/**
 * A course tile. Lecturers see the last session's turnout in big figures; students see who
 * teaches it. `context` (class · school) is shown for courses outside my own classes.
 */
async function CourseCard({
  course,
  isLecturer,
  lastSession,
  context,
}: {
  course: CourseSummary
  isLecturer: boolean
  lastSession?: LastSession | null
  context?: string
}) {
  const t = await getTranslations('dashboard')
  const meta = [course.code, t('semester', { n: course.semester })].filter(Boolean).join(' · ')
  return (
    <Link
      href={`/courses/${encodeURIComponent(course.id)}`}
      className="flex h-full min-h-36 flex-col gap-1 rounded-2xl border bg-card px-5 py-4 outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">{meta}</span>
      <span className="text-lg leading-snug font-semibold">{course.title}</span>
      {context && <span className="text-sm break-words text-muted-foreground">{context}</span>}
      <span className="mt-auto flex items-end justify-between gap-2 border-t border-accent pt-3.5">
        {isLecturer ? (
          lastSession ? (
            <span className="flex flex-col">
              <span className="font-display text-3xl leading-none">
                {lastSession.attended} / {lastSession.total}
              </span>
              <span className="text-[13px] text-muted-foreground">{t('lastSession')}</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{t('noSessions')}</span>
          )
        ) : (
          <span className="text-sm text-muted-foreground">{t('taughtBy', { name: course.lecturerName })}</span>
        )}
        <ArrowRight aria-hidden="true" className={cn('size-4 shrink-0 text-muted-foreground', isLecturer && 'mb-1')} />
      </span>
    </Link>
  )
}
