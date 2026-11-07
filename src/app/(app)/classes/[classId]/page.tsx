import { ArrowRight, Plus, RefreshCw, UserMinus } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ConfirmAction } from '@/components/confirm-action'
import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { Eyebrow, PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getClassRoster, listMyClasses, type ClassSummary, type RosterEntry } from '@/server/classes/service'
import { AppError } from '@/server/core/errors'
import { listLecturerCourses, listStudentCourses, type CourseSummary } from '@/server/courses/service'
import { loadPage } from '../../load-page'
import { regenerateCodeAction, removeStudentAction } from '../actions'

type ClassView =
  | { role: 'lecturer'; cls: ClassSummary; roster: RosterEntry[]; courses: CourseSummary[] }
  | { role: 'student'; cls: ClassSummary; courses: CourseSummary[] }

async function findMyClass(classes: Promise<ClassSummary[]>, classId: string): Promise<ClassSummary> {
  const cls = (await classes).find((c) => c.id === classId)
  // Same answer for "no such class" and "not your class".
  if (!cls) throw new AppError('FORBIDDEN', 'Not a member of this class')
  return cls
}

export async function generateMetadata() {
  const t = await getTranslations('classes.page')
  return { title: t('eyebrow') }
}

export default async function ClassPage({ params }: PageProps<'/classes/[classId]'>) {
  const { classId } = await params
  const t = await getTranslations()
  const view = await loadPage<ClassView>(async (ctx) => {
    if (ctx.user.role === 'lecturer') {
      const roster = await getClassRoster(ctx, classId) // FORBIDDEN unless a lecturer of this class
      const [cls, courses] = await Promise.all([findMyClass(listMyClasses(ctx), classId), listLecturerCourses(ctx)])
      return { role: 'lecturer', cls, roster, courses: courses.filter((c) => c.classId === classId) }
    }
    const [cls, courses] = await Promise.all([findMyClass(listMyClasses(ctx), classId), listStudentCourses(ctx)])
    return { role: 'student', cls, courses: courses.filter((c) => c.classId === classId) }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { cls } = view.data

  return (
    <>
      <PageHeader
        eyebrow={`${t('classes.page.eyebrow')} · ${cls.schoolName}`}
        title={cls.name}
        description={
          <span className="font-mono text-sm tracking-[0.06em] uppercase">
            {t('dashboard.classMeta', { year: cls.academicYear, count: cls.studentCount })}
          </span>
        }
      />
      {view.data.role === 'lecturer' ? (
        <LecturerClass cls={cls} roster={view.data.roster} courses={view.data.courses} />
      ) : (
        <CourseList
          heading={t('classes.page.studentCourses')}
          empty={t('classes.page.studentCoursesEmpty')}
          courses={view.data.courses}
        />
      )}
    </>
  )
}

async function LecturerClass({
  cls,
  roster,
  courses,
}: {
  cls: ClassSummary
  roster: RosterEntry[]
  courses: CourseSummary[]
}) {
  const t = await getTranslations('classes.page')
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <CodeCard
          classId={cls.id}
          kind="student"
          code={cls.studentCode ?? ''}
          label={t('studentCode')}
          hint={t('studentCodeHint')}
          copyLabel={t('copyStudentCode')}
          regenerateLabel={t('regenerateStudentLabel')}
          regenerateTitle={t('regenerateStudentTitle')}
        />
        <CodeCard
          classId={cls.id}
          kind="lecturer"
          code={cls.lecturerCode ?? ''}
          label={t('lecturerCode')}
          hint={t('lecturerCodeHint')}
          copyLabel={t('copyLecturerCode')}
          regenerateLabel={t('regenerateLecturerLabel')}
          regenerateTitle={t('regenerateLecturerTitle')}
        />
      </div>

      <CourseList
        heading={t('courses')}
        empty={t('coursesEmpty')}
        courses={courses}
        action={
          <Link
            href={`/courses/new?classId=${encodeURIComponent(cls.id)}`}
            className={buttonVariants({ variant: 'outline', className: 'self-start' })}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addCourse')}
          </Link>
        }
      />

      <section aria-labelledby="roster" className="flex flex-col gap-4">
        <SectionHeading id="roster">
          {t('roster')} · {roster.length}
        </SectionHeading>
        {roster.length === 0 ? (
          <p className="text-muted-foreground">{t('rosterEmpty')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('rejoinNote')}</p>
            <ul className="flex flex-col divide-y rounded-3xl border">
              {roster.map((student) => (
                <li
                  key={student.studentId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{student.name}</span>
                    <span className="truncate text-sm text-muted-foreground">{student.email}</span>
                  </div>
                  <span className="font-mono text-sm tracking-[0.04em]">
                    <span className="sr-only">{t('matricule')} </span>
                    {student.matricule}
                  </span>
                  <ConfirmAction
                    action={removeStudentAction}
                    fields={{ classId: cls.id, studentId: student.studentId }}
                    triggerLabel={t('remove')}
                    triggerAriaLabel={t('removeLabel', { name: student.name })}
                    triggerIcon={<UserMinus aria-hidden="true" data-icon="inline-start" />}
                    title={t('removeTitle', { name: student.name })}
                    body={t('removeBody')}
                    note={t('rejoinNote')}
                    confirmLabel={t('removeConfirm')}
                    destructive
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  )
}

async function CodeCard({
  classId,
  kind,
  code,
  label,
  hint,
  copyLabel,
  regenerateLabel,
  regenerateTitle,
}: {
  classId: string
  kind: 'student' | 'lecturer'
  code: string
  label: string
  hint: string
  copyLabel: string
  regenerateLabel: string
  regenerateTitle: string
}) {
  const t = await getTranslations('classes.page')
  const labelId = `${kind}-code-label`
  return (
    <Panel className="flex flex-col gap-4">
      <Eyebrow>
        <span id={labelId}>{label}</span>
      </Eyebrow>
      <p
        aria-labelledby={labelId}
        data-testid={`${kind}-code`}
        className="font-mono text-4xl font-semibold tracking-[0.2em] break-all sm:text-5xl"
      >
        {code}
      </p>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={code} label={copyLabel} />
        <ConfirmAction
          action={regenerateCodeAction}
          fields={{ classId, kind }}
          triggerLabel={t('regenerate')}
          triggerAriaLabel={regenerateLabel}
          triggerIcon={<RefreshCw aria-hidden="true" data-icon="inline-start" />}
          title={regenerateTitle}
          body={t('regenerateBody')}
          confirmLabel={t('regenerateConfirm')}
        />
      </div>
    </Panel>
  )
}

async function CourseList({
  heading,
  empty,
  courses,
  action,
}: {
  heading: string
  empty: string
  courses: CourseSummary[]
  action?: React.ReactNode
}) {
  const t = await getTranslations('dashboard')
  return (
    <section aria-labelledby="class-courses" className="flex flex-col gap-4">
      <SectionHeading id="class-courses">{heading}</SectionHeading>
      {courses.length === 0 ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/courses/${encodeURIComponent(course.id)}`}
                className="flex h-full flex-col gap-1 rounded-2xl border bg-card px-5 py-4 outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {course.code && (
                  <span className="font-mono text-xs tracking-[0.08em] text-muted-foreground">{course.code}</span>
                )}
                <span className="text-lg font-semibold">{course.title}</span>
                <span className="mt-auto flex items-center justify-between gap-2 pt-2 text-sm text-muted-foreground">
                  {t('semester', { n: course.semester })}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {action}
    </section>
  )
}
