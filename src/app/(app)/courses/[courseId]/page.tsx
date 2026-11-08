import { ArrowRight, ChartColumn, ClipboardCheck, Hand, ListChecks, NotebookPen, RotateCcw, UserMinus } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { getClassRoster, type RosterEntry } from '@/server/classes/service'
import { getCourse, getCourseRoster, type CourseSummary } from '@/server/courses/service'
import { loadPage } from '../../load-page'
import { IncludeSearch } from '../include-search'
import { RosterButton } from '../roster-button'
import { MyAssignments } from './my-assignments'
import { MyAttendance } from './my-attendance'
import { MyCa } from './my-ca'
import { MyTests } from './my-tests'

type CourseRosterEntry = RosterEntry & { source: 'class' | 'included' }

type CourseView =
  | {
      role: 'lecturer'
      course: CourseSummary
      roster: CourseRosterEntry[]
      excluded: RosterEntry[]
      classHasStudents: boolean
    }
  | { role: 'student'; course: CourseSummary }

export async function generateMetadata() {
  const t = await getTranslations('courses.page')
  return { title: t('eyebrow') }
}

export default async function CoursePage({ params }: PageProps<'/courses/[courseId]'>) {
  const { courseId } = await params
  const t = await getTranslations('courses.page')
  const tAttendance = await getTranslations('attendance.lecturer')
  const tAssignments = await getTranslations('assignments.lecturer')
  const tPerformance = await getTranslations('performance.lecturer')
  const tTests = await getTranslations('tests.lecturer')
  const view = await loadPage<CourseView>(async (ctx) => {
    const course = await getCourse(ctx, courseId) // FORBIDDEN unless owner or rostered student
    if (ctx.user.role !== 'lecturer') return { role: 'student', course }
    const [roster, classRoster] = await Promise.all([getCourseRoster(ctx, courseId), getClassRoster(ctx, course.classId)])
    const onRoster = new Set(roster.map((s) => s.studentId))
    // In the class but not on the roster: excluded from this course.
    const excluded = classRoster.filter((s) => !onRoster.has(s.studentId))
    return { role: 'lecturer', course, roster, excluded, classHasStudents: classRoster.length > 0 }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course } = view.data

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={course.title}
        description={`${course.className} · ${course.schoolName} · ${t('semester', { n: course.semester })}`}
        actions={
          view.data.role === 'lecturer' ? (
            <>
              <Link
                href={`/courses/${encodeURIComponent(course.id)}/attendance`}
                className={buttonVariants({ variant: 'default' })}
              >
                <ClipboardCheck aria-hidden="true" data-icon="inline-start" />
                {tAttendance('courseLink')}
              </Link>
              <Link
                href={`/courses/${encodeURIComponent(course.id)}/assignments`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <NotebookPen aria-hidden="true" data-icon="inline-start" />
                {tAssignments('courseLink')}
              </Link>
              <Link
                href={`/courses/${encodeURIComponent(course.id)}/tests`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <ListChecks aria-hidden="true" data-icon="inline-start" />
                {tTests('courseLink')}
              </Link>
              <Link
                href={`/courses/${encodeURIComponent(course.id)}/performance`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <ChartColumn aria-hidden="true" data-icon="inline-start" />
                {tPerformance('courseLink')}
              </Link>
              <Link
                href={`/courses/${encodeURIComponent(course.id)}/performance/participation`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <Hand aria-hidden="true" data-icon="inline-start" />
                {tPerformance('participationLink')}
              </Link>
              <Link
                href={`/classes/${encodeURIComponent(course.classId)}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                {t('openClass')}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            </>
          ) : undefined
        }
      />
      {view.data.role === 'student' ? (
        <>
          <Panel className="flex flex-col gap-2">
            <Eyebrow>{t('lecturer', { name: course.lecturerName })}</Eyebrow>
            <p className="text-muted-foreground">{t('studentNext')}</p>
          </Panel>
          <MyTests courseId={course.id} />
          <MyAssignments courseId={course.id} />
          <MyAttendance courseId={course.id} />
          <MyCa courseId={course.id} />
        </>
      ) : (
        <LecturerRoster
          courseId={course.id}
          roster={view.data.roster}
          excluded={view.data.excluded}
          classHasStudents={view.data.classHasStudents}
        />
      )}
    </>
  )
}

function StudentRow({ student, children }: { student: RosterEntry; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{student.name}</span>
        <span className="truncate text-sm text-muted-foreground">{student.email}</span>
      </div>
      <span className="font-mono text-sm tracking-[0.04em]">{student.matricule}</span>
      <div className="flex items-center gap-2">{children}</div>
    </li>
  )
}

async function LecturerRoster({
  courseId,
  roster,
  excluded,
  classHasStudents,
}: {
  courseId: string
  roster: CourseRosterEntry[]
  excluded: RosterEntry[]
  classHasStudents: boolean
}) {
  const t = await getTranslations('courses.page')
  return (
    <>
      <section aria-labelledby="course-roster" className="flex flex-col gap-4">
        <SectionHeading id="course-roster">
          {t('roster')} · {t('rosterCount', { count: roster.length })}
        </SectionHeading>
        {roster.length === 0 ? (
          <p className="text-muted-foreground">{t('rosterEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-3xl border">
            {roster.map((student) => (
              <StudentRow key={student.studentId} student={student}>
                <Badge variant={student.source === 'class' ? 'secondary' : 'outline'}>
                  {student.source === 'class' ? t('fromClass') : t('included')}
                </Badge>
                {student.source === 'class' ? (
                  <RosterButton
                    courseId={courseId}
                    studentId={student.studentId}
                    kind="exclude"
                    label={t('exclude')}
                    ariaLabel={t('excludeLabel', { name: student.name })}
                    icon={<UserMinus aria-hidden="true" data-icon="inline-start" />}
                  />
                ) : (
                  <RosterButton
                    courseId={courseId}
                    studentId={student.studentId}
                    kind="clear"
                    label={t('removeInclude')}
                    ariaLabel={t('removeIncludeLabel', { name: student.name })}
                    icon={<UserMinus aria-hidden="true" data-icon="inline-start" />}
                  />
                )}
              </StudentRow>
            ))}
          </ul>
        )}
      </section>

      {excluded.length > 0 && (
        <section aria-labelledby="course-excluded" className="flex flex-col gap-4">
          <SectionHeading id="course-excluded">{t('excludedTitle')}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t('excludedHint')}</p>
          <ul className="flex flex-col divide-y rounded-3xl border">
            {excluded.map((student) => (
              <StudentRow key={student.studentId} student={student}>
                <RosterButton
                  courseId={courseId}
                  studentId={student.studentId}
                  kind="clear"
                  label={t('restore')}
                  ariaLabel={t('restoreLabel', { name: student.name })}
                  icon={<RotateCcw aria-hidden="true" data-icon="inline-start" />}
                />
              </StudentRow>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="course-include" className="flex flex-col gap-4">
        <SectionHeading id="course-include">{t('includeTitle')}</SectionHeading>
        {classHasStudents ? (
          <>
            <p className="text-sm text-muted-foreground">{t('includeHint')}</p>
            <Panel>
              <IncludeSearch courseId={courseId} />
            </Panel>
          </>
        ) : (
          // The search stays closed while the class is empty (the service returns nothing).
          <p className="text-sm text-muted-foreground">{t('includeNeedsClass')}</p>
        )}
      </section>
    </>
  )
}
