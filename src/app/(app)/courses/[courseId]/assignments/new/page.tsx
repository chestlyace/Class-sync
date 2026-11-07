import { ArrowLeft } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { requireCourseOwner } from '@/server/courses/service'
import { config } from '@/server/core/config'
import { loadPage } from '../../../../load-page'
import { AssignmentForm } from '../../../assignment-form'

export async function generateMetadata() {
  const t = await getTranslations('assignments.lecturer')
  return { title: t('newTitle') }
}

export default async function NewAssignmentPage({ params }: PageProps<'/courses/[courseId]/assignments/new'>) {
  const { courseId } = await params
  const t = await getTranslations('assignments.lecturer')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage((ctx) => requireCourseOwner(ctx, courseId)) // lecturer of this course only
  if (!view.ok) return <ErrorState code={view.code} />
  const course = view.data
  const listHref = `/courses/${encodeURIComponent(course.id)}/assignments`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('newTitle')}
        description={`${course.title} · ${course.className}`}
        actions={
          <Link href={listHref} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('allAssignments')}
          </Link>
        }
      />
      <Panel>
        <AssignmentForm target={{ kind: 'create', courseId: course.id }} locale={locale} timeZone={config.timeZone} />
      </Panel>
    </>
  )
}
