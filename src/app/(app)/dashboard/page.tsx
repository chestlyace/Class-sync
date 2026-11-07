import { ArrowRight, KeyRound, Plus } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'
import { listMyClasses, type ClassSummary } from '@/server/classes/service'
import { isVerificationPending } from '@/server/core/guards'
import { listLecturerCourses, listStudentCourses, type CourseSummary } from '@/server/courses/service'
import { loadPage } from '../load-page'
import { groupDashboard } from './group'

export async function generateMetadata() {
  const t = await getTranslations('dashboard')
  return { title: t('title') }
}

export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) return null
  const t = await getTranslations('dashboard')
  const pending = isVerificationPending(user)
  const isLecturer = user.role === 'lecturer'

  const header = (
    <PageHeader
      eyebrow={isLecturer ? t('lecturerEyebrow') : t('studentEyebrow')}
      title={t('greeting', { name: user.name.split(/\s+/)[0] || user.name })}
      // Unverified users get the layout's banner instead of create/join actions.
      actions={pending ? undefined : isLecturer ? <LecturerActions /> : <StudentActions />}
    />
  )
  if (pending) return header

  const data = await loadPage(async (ctx) => {
    const [classes, courses] = await Promise.all([
      listMyClasses(ctx),
      isLecturer ? listLecturerCourses(ctx) : listStudentCourses(ctx),
    ])
    return { classes, courses }
  })
  if (!data.ok) return <ErrorState code={data.code} />
  const { schools, otherCourses } = groupDashboard(data.data.classes, data.data.courses)

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
      {schools.map((group) => (
        <section key={group.schoolId} aria-labelledby={`school-${group.schoolId}`} className="flex flex-col gap-7">
          <SectionHeading id={`school-${group.schoolId}`}>{group.schoolName}</SectionHeading>
          {group.classes.map(({ cls, courses }) => (
            <ClassBlock key={cls.id} cls={cls} courses={courses} isLecturer={isLecturer} />
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
                  footer={isLecturer ? t('semester', { n: course.semester }) : t('taughtBy', { name: course.lecturerName })}
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
      <Link href="/courses/new" className={buttonVariants()}>
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

async function ClassBlock({
  cls,
  courses,
  isLecturer,
}: {
  cls: ClassSummary
  courses: CourseSummary[]
  isLecturer: boolean
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
            <CourseCard
              course={course}
              footer={isLecturer ? t('semester', { n: course.semester }) : t('taughtBy', { name: course.lecturerName })}
            />
          </li>
        ))}
        {isLecturer && (
          <li>
            <Link
              href={`/courses/new?classId=${encodeURIComponent(cls.id)}`}
              className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-input px-5 py-4 text-center font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
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

/** A course tile; `context` (class · school) is shown for courses outside my own classes. */
function CourseCard({ course, footer, context }: { course: CourseSummary; footer: string; context?: string }) {
  return (
    <Link
      href={`/courses/${encodeURIComponent(course.id)}`}
      className="flex h-full min-h-32 flex-col gap-1 rounded-2xl border bg-card px-5 py-4 outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {course.code && <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">{course.code}</span>}
      <span className="text-lg font-semibold">{course.title}</span>
      {context && <span className="text-sm break-words text-muted-foreground">{context}</span>}
      <span className="mt-auto flex items-center justify-between gap-2 border-t border-accent pt-3 text-sm text-muted-foreground">
        {footer}
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </span>
    </Link>
  )
}
