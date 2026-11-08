import { ChevronRight } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { ErrorCodeMessage } from '@/components/action-error'
import { SectionHeading } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locale'
import { formatDecimal } from '@/lib/number-format'
import { listMyAssignments, type StudentAssignmentSummary } from '@/server/assignments/student'
import { config } from '@/server/core/config'
import { loadPage } from '../../load-page'
import { formatSessionDate } from '../attendance-format'

const BADGE: Record<StudentAssignmentSummary['state'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  todo: 'outline',
  submitted: 'secondary',
  late: 'destructive',
  graded: 'default',
  closed: 'outline',
}

/** The signed-in student's assignments on a course, earliest due first, with where each stands. */
export async function MyAssignments({ courseId }: { courseId: string }) {
  const [t, rawLocale] = await Promise.all([getTranslations('assignments.student'), getLocale()])
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE
  const result = await loadPage(async (ctx) => ({
    items: await listMyAssignments(ctx, { courseId }),
    now: new Date(),
  }))

  return (
    <section aria-labelledby="my-assignments" className="flex flex-col gap-4">
      <SectionHeading id="my-assignments">{t('myAssignments')}</SectionHeading>
      {!result.ok ? (
        <p role="alert" className="text-sm text-destructive">
          <ErrorCodeMessage code={result.code} />
        </p>
      ) : result.data.items.length === 0 ? (
        <p className="text-muted-foreground">{t('noAssignments')}</p>
      ) : (
        <AssignmentRows items={result.data.items} locale={locale} now={result.data.now} />
      )}
    </section>
  )
}

/**
 * Rows linking to each assignment page; `now` decides "Due" or "Was due"; `showCourse` adds the
 * course title (dashboard).
 */
export async function AssignmentRows({
  items,
  locale,
  now,
  showCourse = false,
}: {
  items: StudentAssignmentSummary[]
  locale: Locale
  now: Date
  showCourse?: boolean
}) {
  const t = await getTranslations('assignments.student')
  return (
    <ul className="flex flex-col divide-y rounded-3xl border">
      {items.map((a) => {
        const due = formatSessionDate(a.dueAt, locale, config.timeZone)
        return (
          <li key={a.id}>
            <Link
              href={`/assignments/${encodeURIComponent(a.id)}`}
              className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{a.title}</span>
                <span className="text-sm text-muted-foreground">
                  {showCourse && `${a.courseTitle} · `}
                  {a.dueAt.getTime() < now.getTime() ? t('wasDue', { date: due }) : t('dueOn', { date: due })}
                </span>
              </span>
              <Badge variant={BADGE[a.state]}>
                {a.state === 'graded' && a.mark !== null
                  ? t('gradedMark', { mark: formatDecimal(a.mark, locale), max: formatDecimal(a.maxMark, locale) })
                  : t(`state.${a.state}`)}
              </Badge>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
