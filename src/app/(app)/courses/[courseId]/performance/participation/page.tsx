import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getCourse, type CourseSummary } from '@/server/courses/service'
import { listParticipationToday } from '@/server/performance/participation'
import type { CaSettings } from '@/server/performance/rules'
import { getCaSettings } from '@/server/performance/service'
import { loadPage } from '../../../../load-page'
import { ParticipationBoard, type BoardRow } from '../../../participation-board'

type BoardView = { course: CourseSummary; settings: CaSettings; rows: BoardRow[] }

export async function generateMetadata() {
  const t = await getTranslations('performance.lecturer.board')
  return { title: t('title') }
}

export default async function ParticipationPage({ params }: PageProps<'/courses/[courseId]/performance/participation'>) {
  const { courseId } = await params
  const t = await getTranslations('performance.lecturer.board')
  const view = await loadPage<BoardView>(async (ctx) => {
    const rows = await listParticipationToday(ctx, courseId) // FORBIDDEN unless I teach this course
    const [course, settings] = await Promise.all([getCourse(ctx, courseId), getCaSettings(ctx.db, courseId)])
    return { course, settings, rows }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, settings, rows } = view.data
  const caHref = `/courses/${encodeURIComponent(course.id)}/performance`

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('title')}
        description={`${course.title} · ${course.className}`}
        actions={
          <Link href={caHref} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('backToCa')}
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">
        {settings.participationPoints > 0
          ? t('targetHint', { target: settings.participationTarget })
          : t('noPointsHint')}
      </p>
      <ParticipationBoard courseId={course.id} initial={rows} />
    </>
  )
}
