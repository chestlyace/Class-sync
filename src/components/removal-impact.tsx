import { getTranslations } from 'next-intl/server'
import type { DeletionImpact } from '@/server/courses/delete'

const RECORD_KEYS = ['attendanceSessions', 'assignments', 'submissions', 'tests', 'testAttempts', 'notes'] as const

/** The counted warning shown before a course or class is removed; zero counts are left out. */
export async function RemovalImpact({
  impact,
  students,
  showCourses,
}: {
  impact: DeletionImpact
  /** Which wording the student count uses, when students lose anything. */
  students: 'studentsCourse' | 'studentsClass'
  showCourses: boolean
}) {
  const t = await getTranslations('removal')
  const lines: string[] = []
  if (impact.students) lines.push(t(students, { count: impact.students }))
  if (showCourses && impact.courses) lines.push(t('courses', { count: impact.courses }))
  for (const key of RECORD_KEYS) {
    if (impact[key]) lines.push(t(key, { count: impact[key] }))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">{t('heading')}</p>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('nothingYet')}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
