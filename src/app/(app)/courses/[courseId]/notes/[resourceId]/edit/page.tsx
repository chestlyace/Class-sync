import { getLocale, getTranslations } from 'next-intl/server'
import { ErrorState } from '@/components/error-state'
import { PageHeader, Panel } from '@/components/page-header'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { getCourse } from '@/server/courses/service'
import { getItemForEdit } from '@/server/notes/read'
import { loadPage } from '../../../../../load-page'
import { NoteItemForm } from '../../../../note-item-form'
import { NotesBreadcrumb } from '../../../../notes-breadcrumb'

export async function generateMetadata() {
  const t = await getTranslations('notes.lecturer.form')
  return { title: t('editTitle') }
}

export default async function EditNoteItemPage({
  params,
}: PageProps<'/courses/[courseId]/notes/[resourceId]/edit'>) {
  const { courseId, resourceId } = await params
  const t = await getTranslations('notes.lecturer')
  const tForm = await getTranslations('notes.lecturer.form')
  const rawLocale = await getLocale()
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const view = await loadPage(async (ctx) => ({
    item: await getItemForEdit(ctx, courseId, resourceId), // FORBIDDEN unless it is in my course
    course: await getCourse(ctx, courseId),
  }))
  if (!view.ok) return <ErrorState code={view.code} />
  const { item, course } = view.data

  return (
    <>
      <PageHeader
        eyebrow={
          <NotesBreadcrumb
            courseId={course.id}
            courseTitle={course.title}
            notesLabel={t('breadcrumb')}
            last={tForm('editTitle')}
          />
        }
        title={tForm('editTitle')}
        description={item.title}
      />
      {item.alsoIn.length > 0 && (
        <p className="max-w-prose rounded-3xl border bg-muted/40 px-4 py-3 text-sm sm:px-5">
          {tForm('sharedNote', { courses: item.alsoIn.join(', ') })}
        </p>
      )}
      <Panel>
        <NoteItemForm
          kind={item.kind}
          target={{ kind: 'edit', courseId: course.id, resourceId: item.id }}
          initial={{ title: item.title, body: item.body ?? [], url: item.url ?? '', file: item.file }}
          locale={locale}
          cancelHref={`/courses/${encodeURIComponent(course.id)}/notes`}
        />
      </Panel>
    </>
  )
}
