import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

/** "COURSE TITLE › NOTES" (› NEW NOTE…): the mono eyebrow of every notes page. */
export function NotesBreadcrumb({
  courseId,
  courseTitle,
  notesLabel,
  last,
}: {
  courseId: string
  courseTitle: string
  notesLabel: string
  /** The current page when it is below the notes page (the notes page itself passes nothing). */
  last?: string
}) {
  const courseHref = `/courses/${encodeURIComponent(courseId)}`
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <Link href={courseHref} className="underline-offset-4 hover:underline">
        {courseTitle}
      </Link>
      <ChevronRight aria-hidden="true" className="size-3" />
      {last ? (
        <>
          <Link href={`${courseHref}/notes`} className="underline-offset-4 hover:underline">
            {notesLabel}
          </Link>
          <ChevronRight aria-hidden="true" className="size-3" />
          <span aria-current="page">{last}</span>
        </>
      ) : (
        <span aria-current="page">{notesLabel}</span>
      )}
    </span>
  )
}
