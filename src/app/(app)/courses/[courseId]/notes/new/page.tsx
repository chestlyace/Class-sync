import { getLocale, getTranslations } from 'next-intl/server'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { AppError } from '@/server/core/errors'
import { getCourse } from '@/server/courses/service'
import { listCourseTopics } from '@/server/notes/read'
import { loadPage } from '../../../../load-page'
import { NoteItemForm } from '../../../note-item-form'
import { NotesBreadcrumb } from '../../../notes-breadcrumb'
import { isItemKind } from '../../../notes-form'

export async function generateMetadata() {
  const t = await getTranslations('notes.lecturer.form')
  return { title: t('newTitle.note') }
}

export default async function NewNoteItemPage({
  params,
  searchParams,
}: PageProps<'/courses/[courseId]/notes/new'>) {
  const { courseId } = await params
  const { topic, kind: rawKind } = await searchParams
  const kind = isItemKind(rawKind) ? rawKind : 'note'
  const t = await getTranslations('notes.lecturer')
  const tForm = await getTranslations('notes.lecturer.form')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage(async (ctx) => {
    const topics = await listCourseTopics(ctx, courseId) // FORBIDDEN unless I teach this course
    const found = typeof topic === 'string' ? topics.find((x) => x.id === topic) : undefined
    if (!found) throw new AppError('NOT_FOUND', 'Topic not in this course')
    return { course: await getCourse(ctx, courseId), topic: found }
  })
  if (!view.ok) return <ErrorState code={view.code} />
  const { course, topic: chosen } = view.data

  return (
    <>
      <PageHeader
        eyebrow={
          <NotesBreadcrumb
            courseId={course.id}
            courseTitle={course.title}
            notesLabel={t('breadcrumb')}
            last={tForm(`newTitle.${kind}`)}
          />
        }
        title={tForm(`newTitle.${kind}`)}
        description={tForm('inTopic', { topic: chosen.title })}
      />
      <Panel>
        <NoteItemForm
          kind={kind}
          target={{ kind: 'create', courseId: course.id, topicId: chosen.id }}
          locale={locale}
          cancelHref={`/courses/${encodeURIComponent(course.id)}/notes`}
        />
      </Panel>
    </>
  )
}
