import ExcelJS from 'exceljs'
import { createTranslator } from 'next-intl'
import { formatDecimal } from '@/lib/number-format'
import type { Locale } from '@/server/core/context'
import en from '../../../messages/en.json'
import fr from '../../../messages/fr.json'
import type { ComponentKey } from './compute'
import type { CaSettings } from './rules'
import type { StudentCa } from './service'

const messages = { en, fr } as const

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const NUMBER_FORMAT = '0.00'
const LABEL_MAX = 60

type Column = { id: string; key: ComponentKey; name?: string; points: number }

/** The sheet's part columns: the four parts, the tests part split into its named CAs if any. */
function columnsOf(s: CaSettings): Column[] {
  const tests: Column[] =
    s.groups.length === 0
      ? [{ id: 'tests', key: 'tests', points: s.testPoints }]
      : s.groups.map((g) => ({ id: `tests:${g.id}`, key: 'tests', name: g.name, points: g.points }))
  return [
    { id: 'attendance', key: 'attendance', points: s.attendancePoints },
    { id: 'assignments', key: 'assignments', points: s.assignmentPoints },
    { id: 'participation', key: 'participation', points: s.participationPoints },
    ...tests,
  ]
}

/**
 * The lecturer's CA sheet as an .xlsx: Matricule, Name, one column per component that has points,
 * the final CA, then a note. Headers are in `locale`; scores are real numbers written exactly as
 * `computeCa` gave them (already 2 decimals, so the parts add up to the final); rows are in
 * matricule order, then name. A part the class hasn't started is 0; a part that doesn't apply to
 * the student is left empty, and the note says their CA was scaled.
 */
export async function buildCaWorkbook(input: {
  settings: CaSettings
  rows: StudentCa[]
  locale: Locale
  courseLabel: string
}): Promise<Buffer> {
  const { settings, rows, locale, courseLabel } = input
  const t = createTranslator({ locale, messages: messages[locale], namespace: 'performance.export' })
  const label = (key: ComponentKey | 'total', points: number) =>
    t(key, { points: formatDecimal(points, locale) })
  const list = new Intl.ListFormat(locale, { type: 'conjunction' })
  const noteOf = (result: StudentCa['result']): string | null => {
    if (result.notAssessed) return t('notAssessedNote')
    if (!result.scaled) return null
    const parts = result.components
      .filter((c) => c.status === 'not_applicable')
      .map((c) => (c.name === undefined ? t(`notApplicable.${c.key}`) : t('notApplicableGroup', { name: c.name })))
    return t('scaledNote', { parts: list.format(parts) })
  }

  const components = columnsOf(settings).filter((c) => c.points > 0)
  const collator = new Intl.Collator(locale, { numeric: true })
  // Students still without a matricule go last, by name.
  const sorted = [...rows].sort(
    (a, b) =>
      Number(a.matricule === null) - Number(b.matricule === null) ||
      collator.compare(a.matricule ?? '', b.matricule ?? '') ||
      collator.compare(a.name, b.name),
  )

  const workbook = new ExcelJS.Workbook()
  workbook.title = courseLabel
  const sheet = workbook.addWorksheet('CA', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: t('matricule'), key: 'matricule', width: 16 },
    { header: t('name'), key: 'name', width: 32 },
    ...components.map((c) => ({
      header: c.name === undefined ? label(c.key, c.points) : t('group', { name: c.name, points: formatDecimal(c.points, locale) }),
      key: c.id,
      width: 20,
      style: { numFmt: NUMBER_FORMAT },
    })),
    { header: label('total', settings.total), key: 'total', width: 14, style: { numFmt: NUMBER_FORMAT } },
    { header: t('note'), key: 'note', width: 40 },
  ]
  sheet.getRow(1).font = { bold: true }

  for (const row of sorted) {
    const values: Record<string, string | number | null> = { matricule: row.matricule, name: row.name }
    for (const c of components) {
      const part = row.result.components.find((s) => s.id === c.id)
      values[c.id] = part?.status === 'not_applicable' ? null : (part?.score ?? 0)
    }
    values.total = row.result.final
    values.note = noteOf(row.result)
    sheet.addRow(values)
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** `CA-<label>-<YYYY-MM-DD in timeZone>.xlsx`, safe as a file name on every OS. */
export function exportFileName(courseLabel: string, at: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  const safe = courseLabel
    // Path separators, Windows-reserved characters, control characters and whitespace runs.
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f\s]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  const label = Array.from(safe).slice(0, LABEL_MAX).join('').replace(/[-.]+$/, '') || 'course'
  return `CA-${label}-${day}.xlsx`
}
