import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { requireCourseOwner, type CourseSummary } from '@/server/courses/service'
import { getCaSettings } from '@/server/performance/service'
import { loadPage } from '../../../../load-page'
import { TestEditor } from '../../../test-editor'

export async function generateMetadata() {
  const t = await getTranslations('tests.lecturer')
  return { title: t('newTitle') }
}

export default async function NewTestPage({ params }: PageProps<'/courses/[courseId]/tests/new'>) {
  const { courseId } = await params
  const t = await getTranslations('tests.lecturer')
  const view = await loadPage<{ course: CourseSummary; userId: string; caGroups: { id: string; name: string }[] }>(
    async (ctx) => {
      const course = await requireCourseOwner(ctx, courseId) // lecturer of this course only
      const ca = await getCaSettings(ctx.db, courseId)
      return { course, userId: ctx.user.id, caGroups: ca.groups.flatMap((g) => (g.id ? [{ id: g.id, name: g.name }] : [])) }
    },
  )
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, userId, caGroups } = view.data

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('newTitle')}
        description={`${course.title} · ${course.className}`}
        actions={
          <Link href={`/courses/${encodeURIComponent(course.id)}/tests`} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('allTests')}
          </Link>
        }
      />
      <TestEditor courseId={course.id} testId={null} userId={userId} saved={null} caGroups={caGroups} />
    </>
  )
}
