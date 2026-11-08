import { ArrowLeft, ExternalLink, File, FileText, Search, SquareCheck, X } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { formatFileSize } from '@/lib/file-size'
import type { FileInfo } from '@/server/files/service'
import type { getCourseNotes, NoteItem } from '@/server/notes/read'

const ROW =
  'flex min-h-14 items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5'

function fileKind(mimeType: string): 'pdf' | 'word' | 'slides' | 'image' | 'other' {
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.includes('presentation') || mimeType === 'application/vnd.ms-powerpoint') return 'slides'
  if (mimeType.includes('word')) return 'word'
  return 'other'
}

/** A student's notes for a course: search, then topics with their notes, files, links and the practice entry. */
export async function StudentNotes({
  data,
  q = '',
}: {
  data: Awaited<ReturnType<typeof getCourseNotes>>
  q?: string
}) {
  const [t, rawLocale] = await Promise.all([getTranslations('notes.student'), getLocale()])
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const { course, topics } = data
  const courseHref = `/courses/${encodeURIComponent(course.id)}`
  const query = q.trim()

  function meta(item: NoteItem): string {
    if (item.kind === 'note') return t('noteMeta')
    if (item.kind === 'link') return item.host ?? ''
    const file = item.file as FileInfo
    return `${t(`fileType.${fileKind(file.mimeType)}`)} · ${formatFileSize(file.sizeBytes, locale)}`
  }

  return (
    <>
      <PageHeader
        eyebrow={course.code ? `${t('eyebrow')} · ${course.code}` : t('eyebrow')}
        title={t('title')}
        description={course.title}
        actions={
          <Link href={courseHref} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('back', { course: course.title })}
          </Link>
        }
      />

      <form action="" method="get" role="search" className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            aria-label={t('searchLabel')}
            placeholder={t('searchPlaceholder')}
            className="h-11 w-full rounded-full border border-input bg-background pr-4 pl-10 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
          />
        </div>
        <button type="submit" className={buttonVariants({ variant: 'default', className: 'h-11' })}>
          {t('searchButton')}
        </button>
        {query && (
          <Link
            href={`${courseHref}/notes`}
            aria-label={t('clearSearch')}
            className={buttonVariants({ variant: 'outline', size: 'icon', className: 'size-11' })}
          >
            <X aria-hidden="true" />
          </Link>
        )}
      </form>

      {topics.length === 0 ? (
        <p className="text-muted-foreground">{query ? t('noResults', { q: query }) : t('empty')}</p>
      ) : (
        topics.map((topic, index) => {
          const headingId = `topic-${topic.id}`
          return (
            <section key={topic.id} aria-labelledby={headingId} className="flex flex-col gap-3">
              <h2 id={headingId} className="min-w-0 font-mono text-[13px] font-semibold tracking-[0.1em] break-words uppercase">
                {t('topicHeading', { n: index + 1, title: topic.title })}
              </h2>
              <ul className="flex flex-col divide-y rounded-3xl border bg-card">
                {topic.items.map((item) => {
                  const inner = (
                    <>
                      {item.kind === 'note' ? (
                        <FileText aria-hidden="true" className="size-5 shrink-0 text-primary" />
                      ) : item.kind === 'file' ? (
                        <File aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ExternalLink aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-medium break-words">{item.title}</span>
                        <span className="text-sm break-words text-muted-foreground">{meta(item)}</span>
                      </span>
                      {item.isNew && <Badge className="font-mono tracking-[0.1em] uppercase">{t('newBadge')}</Badge>}
                    </>
                  )
                  const base = `${courseHref}/notes/${encodeURIComponent(item.id)}`
                  return (
                    <li key={item.id}>
                      {item.kind === 'note' ? (
                        <Link href={base} className={ROW}>
                          {inner}
                        </Link>
                      ) : (
                        <a
                          href={`${base}/open`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t(item.kind === 'file' ? 'openFile' : 'openLink', { title: item.title })}
                          className={ROW}
                        >
                          {inner}
                        </a>
                      )}
                    </li>
                  )
                })}
                {topic.practice && !query && (
                  <li>
                    <Link href={`${courseHref}/notes/topics/${encodeURIComponent(topic.id)}/practice`} className={ROW}>
                      <SquareCheck aria-hidden="true" className="size-5 shrink-0 text-green-600" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="font-medium">{t('practiceTitle')}</span>
                        <span className="text-sm text-muted-foreground">
                          {t('practiceMeta', { count: topic.practice.count })}
                        </span>
                      </span>
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          )
        })
      )}
    </>
  )
}
