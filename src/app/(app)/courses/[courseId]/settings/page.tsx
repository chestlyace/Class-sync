import { ExternalLink } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { CopyButton } from '@/components/copy-button'
import { DeleteConfirmForm } from '@/components/delete-confirm-form'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { RemovalImpact } from '@/components/removal-impact'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { config } from '@/server/core/config'
import { getCourseDeletionImpact } from '@/server/courses/delete'
import { requireCourseOwner } from '@/server/courses/service'
import { localDateOf } from '@/server/lib/local-time'
import { googleMeetAccess } from '@/server/auth/google-meet-access'
import { getClassroom } from '@/server/schedule/classroom'
import { canUseClassroom } from '@/server/schedule/classroom-switch'
import { loadPage } from '../../../load-page'
import { ClassroomButton } from '../../../schedule/classroom-button'
import { formatDay } from '../../../schedule/schedule-format'
import { deleteCourseAction } from '../../actions'
import { EditCourseForm } from './edit-course-form'

export async function generateMetadata() {
  const t = await getTranslations('courses.settings')
  return { title: t('eyebrow') }
}

export default async function CourseSettingsPage({ params }: PageProps<'/courses/[courseId]/settings'>) {
  const { courseId } = await params
  const t = await getTranslations()
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  // Owner only: a colleague sharing the class and the course's students get FORBIDDEN.
  const view = await loadPage(async (ctx) => {
    const course = await requireCourseOwner(ctx, courseId)
    // The Classroom panel: hidden unless the switch allows it; Google is only asked about when there is no room.
    const showClassroom = canUseClassroom(ctx.user)
    const classroom = showClassroom ? await getClassroom(ctx.db, courseId) : null
    const googleGranted =
      showClassroom && !classroom ? ((await googleMeetAccess(ctx.db, ctx.user.id))?.granted ?? false) : false
    return {
      course,
      impact: await getCourseDeletionImpact(ctx, courseId),
      showClassroom,
      classroom,
      googleGranted,
    }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, impact, showClassroom, classroom, googleGranted } = view.data

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <PageHeader
        eyebrow={t('courses.settings.eyebrow')}
        title={course.title}
        description={t('courses.settings.description')}
      />
      <Panel className="flex flex-col gap-5">
        <SectionHeading>{t('courses.settings.editTitle')}</SectionHeading>
        <EditCourseForm course={course} />
      </Panel>
      {showClassroom && (
        <Panel className="flex flex-col gap-5">
          <SectionHeading>{t('courses.settings.classroom')}</SectionHeading>
          {classroom ? (
            <div className="flex flex-col gap-3">
              <span className="min-w-0 font-mono text-sm wrap-anywhere">{classroom.meetingUrl}</span>
              <div className="flex flex-wrap gap-2">
                <a
                  href={classroom.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ size: 'lg' })}
                >
                  <ExternalLink aria-hidden="true" data-icon="inline-start" />
                  {t('schedule.classPage.openLink')}
                </a>
                <CopyButton
                  value={classroom.meetingUrl}
                  label={t('schedule.classPage.copyLink')}
                  text={t('schedule.classPage.copyLink')}
                  variant="outline"
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {t('courses.settings.classroomCreated', {
                  date: formatDay(localDateOf(classroom.createdAt, config.timeZone), locale, 'date'),
                })}
              </p>
              {!classroom.knockingConfirmed && (
                <p className="text-sm text-muted-foreground">{t('schedule.online.quickAccessTip')}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('schedule.online.useClassroomHint')}</p>
              <ClassroomButton courseId={course.id} googleGranted={googleGranted} />
            </div>
          )}
        </Panel>
      )}
      <Panel className="flex flex-col gap-5 border-destructive/30">
        <div className="flex flex-col gap-2">
          <SectionHeading>{t('courses.settings.deleteTitle')}</SectionHeading>
          <p className="text-sm text-muted-foreground">{t('courses.settings.deleteBody')}</p>
        </div>
        <RemovalImpact impact={impact} students="studentsCourse" showCourses={false} />
        <DeleteConfirmForm
          action={deleteCourseAction}
          hidden={{ courseId: course.id }}
          confirmText={course.title}
          label={t('removal.confirmLabel', { name: course.title })}
          buttonLabel={t('courses.settings.delete')}
          pendingLabel={t('courses.settings.deleting')}
        />
      </Panel>
    </div>
  )
}
