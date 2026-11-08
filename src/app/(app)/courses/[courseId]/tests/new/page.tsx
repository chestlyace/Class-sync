import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { requireCourseOwner, type CourseSummary } from '@/server/courses/service'
import { loadPage } from '../../../../load-page'
import { TestEditor } from '../../../test-editor'

export async function generateMetadata() {
  const t = await getTranslations('tests.lecturer')
  return { title: t('newTitle') }
}

export default async function NewTestPage({ params }: PageProps<'/courses/[courseId]/tests/new'>) {
  const { courseId } = await params
  const t = await getTranslations('tests.lecturer')
  const view = await loadPage<{ course: CourseSummary; userId: string }>(async (ctx) => ({
    course: await requireCourseOwner(ctx, courseId), // lecturer of this course only
    userId: ctx.user.id,
  }))
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, userId } = view.data

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
      <TestEditor courseId={course.id} testId={null} userId={userId} saved={null} />
    </>
  )
}
