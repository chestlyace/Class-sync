import { NotebookText } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { SectionHeading } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'

/** The student's way into a course's notes (the list itself lives on the notes page). */
export async function MyNotes({ courseId }: { courseId: string }) {
  const t = await getTranslations('notes.student.section')
  return (
    <section aria-labelledby="my-notes" className="flex flex-col gap-4">
      <SectionHeading id="my-notes">{t('title')}</SectionHeading>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-muted-foreground">{t('body')}</p>
        <Link href={`/courses/${encodeURIComponent(courseId)}/notes`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          <NotebookText aria-hidden="true" data-icon="inline-start" />
          {t('open')}
        </Link>
      </div>
    </section>
  )
}
