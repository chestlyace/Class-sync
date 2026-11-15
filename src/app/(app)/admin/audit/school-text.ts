import type { AuditTarget } from '@/server/admin/queries'

type SchoolDetails = Extract<AuditTarget, { kind: 'school' }>['details']
type SchoolKey = 'audit.school.update' | 'audit.school.delete' | 'audit.school.merge'
/** The admin namespace's translator, narrowed to the keys used here. */
type Translate = (key: SchoolKey, values: Record<string, string | number>) => string

/** What a school action changed, from the names kept in the audit row (the school may be gone). */
export function schoolAuditText(details: SchoolDetails, t: Translate): string {
  switch (details.kind) {
    case 'school_update':
      return t('audit.school.update', {
        before: details.before.name,
        beforeTown: details.before.town,
        after: details.after.name,
        town: details.after.town,
      })
    case 'school_delete':
      return t('audit.school.delete', { name: details.school.name, town: details.school.town, classes: details.classes })
    case 'school_merge':
      return t('audit.school.merge', { from: details.from.name, into: details.into.name })
  }
}
