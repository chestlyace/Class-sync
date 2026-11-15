import { getTranslations } from 'next-intl/server'
import { DeleteConfirmForm } from '@/components/delete-confirm-form'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { RemovalImpact } from '@/components/removal-impact'
import { getCourseDeletionImpact } from '@/server/courses/delete'
import { requireCourseOwner } from '@/server/courses/service'
import { loadPage } from '../../../load-page'
import { deleteCourseAction } from '../../actions'
import { EditCourseForm } from './edit-course-form'

export async function generateMetadata() {
  const t = await getTranslations('courses.settings')
  return { title: t('eyebrow') }
}

export default async function CourseSettingsPage({ params }: PageProps<'/courses/[courseId]/settings'>) {
  const { courseId } = await params
  const t = await getTranslations()
  // Owner only: a colleague sharing the class and the course's students get FORBIDDEN.
  const view = await loadPage(async (ctx) => {
    const course = await requireCourseOwner(ctx, courseId)
    return { course, impact: await getCourseDeletionImpact(ctx, courseId) }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, impact } = view.data

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
