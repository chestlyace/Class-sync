import { getTranslations } from 'next-intl/server'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { config } from '@/server/core/config'
import { getCourseNotes } from '@/server/notes/read'
import { loadPage } from '../../../load-page'
import { NotesBreadcrumb } from '../../notes-breadcrumb'
import { NewTopicDialog, NotesLecturer } from '../../notes-lecturer'
import { StudentNotes } from '../../notes-student'

export async function generateMetadata() {
  const t = await getTranslations('notes.lecturer')
  return { title: t('title') }
}

export default async function CourseNotesPage({
  params,
  searchParams,
}: PageProps<'/courses/[courseId]/notes'>) {
  const { courseId } = await params
  const { q } = await searchParams
  const t = await getTranslations('notes.lecturer')
  const view = await loadPage((ctx) =>
    getCourseNotes(ctx, courseId, { q: typeof q === 'string' ? q : undefined }),
  ) // FORBIDDEN unless I teach this course or I am on its roster
  if (!view.ok) return <ErrorState code={view.code} />
  const data = view.data
  if (data.role === 'student') return <StudentNotes data={data} />

  return (
    <>
      <PageHeader
        eyebrow={
          <NotesBreadcrumb courseId={data.course.id} courseTitle={data.course.title} notesLabel={t('breadcrumb')} />
        }
        title={t('title')}
        description={t('description')}
        actions={<NewTopicDialog courseId={data.course.id} />}
      />
      <NotesLecturer
        courseId={data.course.id}
        topics={data.topics}
        otherCourses={data.otherCourses}
        timeZone={config.timeZone}
      />
    </>
  )
}
