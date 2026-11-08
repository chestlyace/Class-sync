import { ArrowLeft, Download, Hand } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import type { CaSettings } from '@/server/performance/rules'
import { getCourseCa, type StudentCa } from '@/server/performance/service'
import { loadPage } from '../../../load-page'
import { CaSettingsForm } from '../../ca-settings-form'
import { CaTable } from '../../ca-table'

type CaView = { course: CourseSummary; settings: CaSettings; rows: StudentCa[] }

export async function generateMetadata() {
  const t = await getTranslations('performance.lecturer')
  return { title: t('title') }
}

export default async function CoursePerformancePage({ params }: PageProps<'/courses/[courseId]/performance'>) {
  const { courseId } = await params
  const t = await getTranslations('performance.lecturer')
  const view = await loadPage<CaView>(async (ctx) => {
    const ca = await getCourseCa(ctx, courseId) // FORBIDDEN unless I teach this course
    return { course: await getCourse(ctx, courseId), ...ca }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, settings, rows } = view.data
  const courseHref = `/courses/${encodeURIComponent(course.id)}`
  const slipping = rows.filter((r) => r.slipping).length
  const missing = rows.filter((r) => r.missingWork > 0).length

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('title')}
        description={`${course.title} · ${course.className}`}
        actions={
          <>
            <Link href={`${courseHref}/performance/participation`} className={buttonVariants({ variant: 'default' })}>
              <Hand aria-hidden="true" data-icon="inline-start" />
              {t('participationLink')}
            </Link>
            {/* A file download, not a page: a plain link, so the router doesn't prefetch it. */}
            <a href={`${courseHref}/performance/export`} download className={buttonVariants({ variant: 'outline' })}>
              <Download aria-hidden="true" data-icon="inline-start" />
              {t('export')}
            </a>
            <Link href={courseHref} className={buttonVariants({ variant: 'outline' })}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {course.title}
            </Link>
          </>
        }
      />

      <section aria-labelledby="ca-class" className="flex flex-col gap-4">
        <SectionHeading id="ca-class">
          {t('classTitle')} · {t('studentCount', { count: rows.length })}
        </SectionHeading>
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{t('noStudents')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {t('summary', { slipping, missing })}
            </p>
            <CaTable courseId={course.id} rows={rows} />
            <p className="text-sm text-muted-foreground">{t('legend')}</p>
          </>
        )}
      </section>

      <section aria-labelledby="ca-settings" className="flex flex-col gap-4">
        <SectionHeading id="ca-settings">{t('settings.title')}</SectionHeading>
        <p className="text-sm text-muted-foreground">{t('settings.hint')}</p>
        <Panel>
          <CaSettingsForm courseId={course.id} initial={settings} />
        </Panel>
      </section>
    </>
  )
}
