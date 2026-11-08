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

const COMPONENTS: { key: ComponentKey; points: (s: CaSettings) => number }[] = [
  { key: 'attendance', points: (s) => s.attendancePoints },
  { key: 'assignments', points: (s) => s.assignmentPoints },
  { key: 'participation', points: (s) => s.participationPoints },
]

/** Rounds to 2 decimals so float noise (3.1300000000000003) never reaches the sheet. */
function round2(x: number): number {
  return Math.round(x * 100 + 1e-7) / 100
}

/**
 * The lecturer's CA sheet as an .xlsx: Matricule, Name, one column per component that has points,
 * then the final CA (a not-started component counts 0). Headers are in `locale`; scores are real
 * numbers rounded to 2 decimals; rows are in matricule order, then name.
 */
export async function buildCaWorkbook(input: {
  settings: CaSettings
  rows: StudentCa[]
  locale: Locale
  courseLabel: string
}): Promise<Buffer> {
  const { settings, rows, locale, courseLabel } = input
  const t = createTranslator({ locale, messages: messages[locale], namespace: 'performance.export' })
  const label = (key: 'attendance' | 'assignments' | 'participation' | 'total', points: number) =>
    t(key, { points: formatDecimal(points, locale) })

  const components = COMPONENTS.filter((c) => c.points(settings) > 0)
  const collator = new Intl.Collator(locale, { numeric: true })
  const sorted = [...rows].sort(
    (a, b) => collator.compare(a.matricule, b.matricule) || collator.compare(a.name, b.name),
  )

  const workbook = new ExcelJS.Workbook()
  workbook.title = courseLabel
  const sheet = workbook.addWorksheet('CA', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: t('matricule'), key: 'matricule', width: 16 },
    { header: t('name'), key: 'name', width: 32 },
    ...components.map((c) => ({
      header: label(c.key, c.points(settings)),
      key: c.key,
      width: 20,
      style: { numFmt: NUMBER_FORMAT },
    })),
    { header: label('total', settings.total), key: 'total', width: 14, style: { numFmt: NUMBER_FORMAT } },
  ]
  sheet.getRow(1).font = { bold: true }

  for (const row of sorted) {
    const values: Record<string, string | number> = { matricule: row.matricule, name: row.name }
    for (const c of components) {
      values[c.key] = round2(row.result.components.find((s) => s.key === c.key)?.score ?? 0)
    }
    values.total = round2(row.result.final)
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
