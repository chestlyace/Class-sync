import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { ErrorState } from '@/components/error-state'
import { getCourseNotes } from '@/server/notes/read'
import { loadPage } from '../../../load-page'
import { StudentNotes } from '../../notes-student'

export async function generateMetadata() {
  const t = await getTranslations('notes.student')
  return { title: t('title') }
}

// Minimal stand-in so the student screens run on this branch; the lecturer page (Task 5) replaces it.
export default async function NotesPage({
  params,
  searchParams,
}: PageProps<'/courses/[courseId]/notes'>) {
  const { courseId } = await params
  const raw = (await searchParams).q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 100) ?? ''
  const result = await loadPage((ctx) => getCourseNotes(ctx, courseId, { q }))
  if (!result.ok) return <ErrorState code={result.code} />
  if (result.data.role === 'lecturer') redirect(`/courses/${encodeURIComponent(courseId)}`)
  return <StudentNotes data={result.data} q={q} />
}
