import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { AppError } from '@/server/core/errors'
import type { CourseSummary } from '@/server/courses/service'
import { getPracticeForLecturer, type PracticeGroupView, type PracticeQuestionView } from '@/server/revision/authoring'
import { getPracticePaper } from '@/server/revision/practice'
import { loadPage } from '../../../../../../load-page'
import { PracticeEditor } from '../../../../../practice-editor'
import { PracticeRunner } from '../../../../../practice-runner'

type PracticeView =
  | {
      role: 'lecturer'
      course: CourseSummary
      topic: { id: string; title: string }
      groups: PracticeGroupView[]
      importable: { id: string; title: string }[]
    }
  | {
      role: 'student'
      topic: { id: string; title: string }
      questions: PracticeQuestionView[]
      outcomes: Record<string, boolean>
    }

export async function generateMetadata() {
  const t = await getTranslations('revision.lecturer')
  return { title: t('eyebrow') }
}

export default async function PracticePage({ params }: PageProps<'/courses/[courseId]/notes/topics/[topicId]/practice'>) {
  const { courseId, topicId } = await params
  const t = await getTranslations('revision.lecturer')
  const view = await loadPage<PracticeView>(async (ctx) => {
    if (ctx.user.role === 'student') {
      const paper = await getPracticePaper(ctx, courseId, topicId) // FORBIDDEN unless rostered and the topic is visible
      return { role: 'student', ...paper }
    }
    const data = await getPracticeForLecturer(ctx, topicId) // FORBIDDEN unless I teach the topic's course
    if (data.course.id !== courseId) throw new AppError('FORBIDDEN', 'This topic is not in this course')
    return {
      role: 'lecturer',
      course: data.course,
      topic: data.topic,
      groups: data.groups,
      importable: data.importable.map((test) => ({ id: test.id, title: test.title })),
    }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const data = view.data
  const notesHref = `/courses/${encodeURIComponent(courseId)}/notes`

  if (data.role === 'student') {
    return (
      <PracticeRunner courseId={courseId} topicTitle={data.topic.title} questions={data.questions} outcomes={data.outcomes} />
    )
  }
  return (
    <>
      <PageHeader
        eyebrow={data.course.code ? `${t('eyebrow')} · ${data.course.code}` : t('eyebrow')}
        title={data.topic.title}
        description={`${data.course.title} · ${data.course.className}`}
        actions={
          <Link href={notesHref} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('backToNotes')}
          </Link>
        }
      />
      <PracticeEditor topicId={data.topic.id} groups={data.groups} importable={data.importable} />
    </>
  )
}
