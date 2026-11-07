import { getTranslations } from 'next-intl/server'
import { SectionHeading } from '@/components/page-header'
import type { Locale } from '@/i18n/locale'
import type { StudentAssignmentSummary } from '@/server/assignments/student'
import { AssignmentRows } from '../courses/[courseId]/my-assignments'

/** Student dashboard: assignments due in the next 7 days. Nothing at all when there are none. */
export async function DueSoon({
  items,
  locale,
  now,
}: {
  items: StudentAssignmentSummary[]
  locale: Locale
  now: Date
}) {
  if (items.length === 0) return null
  const t = await getTranslations('assignments.student')
  return (
    <section aria-labelledby="due-soon" className="flex flex-col gap-4">
      <SectionHeading id="due-soon">{t('dueThisWeek')}</SectionHeading>
      <AssignmentRows items={items} locale={locale} now={now} showCourse />
    </section>
  )
}
