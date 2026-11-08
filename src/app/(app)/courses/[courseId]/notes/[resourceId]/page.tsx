import { ArrowLeft } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorState } from '@/components/error-state'
import { Eyebrow } from '@/components/page-header'
import { RichTextView } from '@/components/rich-text-view'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { config } from '@/server/core/config'
import { getCourseNotes, getNote } from '@/server/notes/read'
import { loadPage } from '../../../../load-page'

export async function generateMetadata() {
  const t = await getTranslations('notes.student')
  return { title: t('title') }
}

/** A note, for the lecturer of the course and for its students. Opening it counts as read. */
export default async function NotePage({ params }: PageProps<'/courses/[courseId]/notes/[resourceId]'>) {
  const { courseId, resourceId } = await params
  const [t, rawLocale] = await Promise.all([getTranslations('notes.student'), getLocale()])
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const result = await loadPage(async (ctx) => {
    const note = await getNote(ctx, courseId, resourceId) // FORBIDDEN unless visible to me
    const notes = await getCourseNotes(ctx, courseId)
    return { note, course: notes.course, topicNumber: notes.topics.findIndex((x) => x.id === note.topic.id) + 1 }
  })
  if (!result.ok) return <ErrorState code={result.code} />
  const { note, course, topicNumber } = result.data
  const notesHref = `/courses/${encodeURIComponent(courseId)}/notes`
  const date = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: config.timeZone,
  }).format(note.updatedAt)

  return (
    <>
      <div className="flex items-center gap-3">
        <Link
          href={notesHref}
          aria-label={t('allNotes')}
          className={buttonVariants({ variant: 'outline', size: 'icon', className: 'size-11 shrink-0' })}
        >
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div className="flex min-w-0 flex-col">
          <Eyebrow className="break-words">
            {t('topicLabel', { course: course.code ?? course.title, n: topicNumber })}
          </Eyebrow>
          <span className="font-medium break-words">{note.topic.title}</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em] break-words sm:text-6xl">{note.title}</h1>
        <p className="text-sm text-muted-foreground">{t('updated', { lecturer: course.lecturerName, date })}</p>
      </div>

      <article className="min-w-0 max-w-full">
        <RichTextView value={note.body} locale={locale} />
      </article>

      <div className="flex flex-wrap gap-2.5">
        <Link href={notesHref} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          {t('allNotes')}
        </Link>
        {note.practiceCount > 0 && (
          <Link
            href={`${notesHref}/topics/${encodeURIComponent(note.topic.id)}/practice`}
            className={buttonVariants({ variant: 'default', size: 'lg' })}
          >
            {t('practise')}
          </Link>
        )}
      </div>
    </>
  )
}
