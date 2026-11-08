import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { type CaInput, computeCa } from './compute'
import { buildCaWorkbook, exportFileName } from './export'
import { DEFAULT_SETTINGS, type CaSettings } from './rules'
import type { StudentCa } from './service'

const XLSX_MAGIC = [0x50, 0x4b] // "PK": an .xlsx is a zip

const ALL_STARTED: CaInput['classStarted'] = { attendance: true, assignments: true, participation: true }

/** A student with every component started: attendance 3/5, assignments 10/20, participation 5/5. */
function student(over: Partial<StudentCa> & { name: string; matricule: string }, settings: CaSettings = DEFAULT_SETTINGS): StudentCa {
  const result = computeCa(settings, {
    attendance: { present: 3, partial: 0, absent: 2 },
    assignments: [{ weight: 1, mark: 10, maxMark: 20 }],
    participationNet: 5,
    classStarted: ALL_STARTED,
  })
  return {
    studentId: over.matricule,
    result,
    attendanceRatio: 0.6,
    countedSessions: 5,
    missingWork: 0,
    slipping: false,
    rank: 1,
    ...over,
  }
}

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)
  return wb
}

const cellsOf = (row: ExcelJS.Row) => (row.values as ExcelJS.CellValue[]).slice(1)

describe('buildCaWorkbook', () => {
  it('writes one sheet "CA" with a bold, frozen French header for fr, the CA called CC', async () => {
    const buffer = await buildCaWorkbook({
      settings: DEFAULT_SETTINGS,
      rows: [student({ name: 'Ada', matricule: 'UB1' })],
      locale: 'fr',
      courseLabel: 'Algo',
    })
    expect([...buffer.subarray(0, 2)]).toEqual(XLSX_MAGIC)
    const wb = await read(buffer)
    expect(wb.worksheets.map((s) => s.name)).toEqual(['CA'])
    const ws = wb.getWorksheet('CA')!
    expect(cellsOf(ws.getRow(1))).toEqual([
      'Matricule',
      'Nom',
      'Présence (/5)',
      'Devoirs (/20)',
      'Participation (/5)',
      'CC (/30)',
      'Remarque',
    ])
    expect(ws.getRow(1).font?.bold).toBe(true)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    for (let c = 1; c <= 7; c++) expect(ws.getColumn(c).width).toBeGreaterThan(5)
  })

  it('uses English headers for en, with numbers in the lecturer format', async () => {
    const settings: CaSettings = { ...DEFAULT_SETTINGS, total: 30, attendancePoints: 5.5, assignmentPoints: 19.5 }
    const header = async (locale: 'en' | 'fr') =>
      cellsOf(
        (await read(await buildCaWorkbook({ settings, rows: [], locale, courseLabel: 'x' }))).getWorksheet('CA')!.getRow(1),
      )
    expect(await header('en')).toEqual([
      'Matricule',
      'Name',
      'Attendance (/5.5)',
      'Assignments (/19.5)',
      'Participation (/5)',
      'CA (/30)',
      'Note',
    ])
    expect((await header('fr'))[2]).toBe('Présence (/5,5)')
  })

  it('leaves out a component with 0 points', async () => {
    const settings: CaSettings = { ...DEFAULT_SETTINGS, attendancePoints: 0, assignmentPoints: 25 }
    const wb = await read(
      await buildCaWorkbook({
        settings,
        rows: [student({ name: 'Ada', matricule: 'UB1' }, settings)],
        locale: 'en',
        courseLabel: 'x',
      }),
    )
    const ws = wb.getWorksheet('CA')!
    expect(cellsOf(ws.getRow(1))).toEqual([
      'Matricule',
      'Name',
      'Assignments (/25)',
      'Participation (/5)',
      'CA (/30)',
      'Note',
    ])
    expect(cellsOf(ws.getRow(2))).toEqual(['UB1', 'Ada', 12.5, 5, 17.5])
  })

  it('orders rows by matricule (numeric-aware), then name', async () => {
    const rows = [
      student({ name: 'Zed', matricule: 'UB10' }),
      student({ name: 'Bea', matricule: 'UB2' }),
      student({ name: 'Cy', matricule: 'UB1', studentId: 'c' }),
      student({ name: 'Al', matricule: 'UB1', studentId: 'a' }),
    ]
    const ws = (await read(await buildCaWorkbook({ settings: DEFAULT_SETTINGS, rows, locale: 'en', courseLabel: 'x' }))).getWorksheet('CA')!
    const order = [2, 3, 4, 5].map((r) => [ws.getRow(r).getCell(1).value, ws.getRow(r).getCell(2).value])
    expect(order).toEqual([
      ['UB1', 'Al'],
      ['UB1', 'Cy'],
      ['UB2', 'Bea'],
      ['UB10', 'Zed'],
    ])
  })

  it('writes the computed numbers as they are, so the parts add up; numbers with format 0.00, matricule as text', async () => {
    const settings: CaSettings = {
      total: 15,
      attendancePoints: 5,
      assignmentPoints: 5,
      participationPoints: 5,
      testPoints: 0,
      participationTarget: 3,
    }
    const result = computeCa(settings, {
      attendance: { present: 1, partial: 0, absent: 2 },
      assignments: [{ weight: 1, mark: 1, maxMark: 3 }],
      participationNet: 1,
      classStarted: ALL_STARTED,
    })
    const ada = student({ name: 'Ada', matricule: '007', result }, settings)
    const ws = (await read(await buildCaWorkbook({ settings, rows: [ada], locale: 'en', courseLabel: 'x' }))).getWorksheet('CA')!
    const row = ws.getRow(2)
    expect(row.getCell(1).value).toBe('007')
    // Each third of 5 is 1.67, and the CA is their sum, 5.01.
    expect([3, 4, 5, 6].map((c) => row.getCell(c).value)).toEqual([1.67, 1.67, 1.67, 5.01])
    for (let c = 3; c <= 6; c++) {
      expect(typeof row.getCell(c).value).toBe('number')
      expect(row.getCell(c).numFmt).toBe('0.00')
    }
    expect(row.getCell(7).value).toBeNull()
  })

  it('exports the final CA with a not-started component as 0', async () => {
    const empty = computeCa(DEFAULT_SETTINGS, {
      attendance: { present: 4, partial: 0, absent: 0 },
      assignments: [],
      participationNet: 0,
      classStarted: { attendance: true, assignments: false, participation: false },
    })
    expect(empty.components.find((c) => c.key === 'assignments')!.score).toBeNull()
    const ws = (
      await read(
        await buildCaWorkbook({
          settings: DEFAULT_SETTINGS,
          rows: [student({ name: 'Ada', matricule: 'UB1', result: empty })],
          locale: 'en',
          courseLabel: 'x',
        }),
      )
    ).getWorksheet('CA')!
    expect(cellsOf(ws.getRow(2))).toEqual(['UB1', 'Ada', 5, 0, 0, 5])
    expect(ws.getRow(2).getCell(7).value).toBeNull()
  })

  it('leaves a not-applicable part empty and says in the note why the CA was scaled', async () => {
    // Assignments have started for the class but don't apply to this student: 5 + 5, scaled to 30.
    const scaled = computeCa(DEFAULT_SETTINGS, {
      attendance: { present: 1, partial: 0, absent: 0 },
      assignments: [],
      participationNet: 5,
      classStarted: ALL_STARTED,
    })
    const rows = [student({ name: 'Ada', matricule: 'UB1', result: scaled }), student({ name: 'Bea', matricule: 'UB2' })]
    const sheet = async (locale: 'en' | 'fr') =>
      (await read(await buildCaWorkbook({ settings: DEFAULT_SETTINGS, rows, locale, courseLabel: 'x' }))).getWorksheet('CA')!

    const en = await sheet('en')
    const ada = en.getRow(2)
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => ada.getCell(c).value)).toEqual([
      'UB1',
      'Ada',
      5,
      null,
      5,
      30,
      'Scaled: Assignments not applicable',
    ])
    // Bea has every part: no note.
    expect(en.getRow(3).getCell(4).value).toBe(10)
    expect(en.getRow(3).getCell(7).value).toBeNull()

    expect((await sheet('fr')).getRow(2).getCell(7).value).toBe("Mis à l'échelle : Devoirs non applicables")
  })

  it('notes a student no part applies to as not assessed', async () => {
    const settings: CaSettings = { ...DEFAULT_SETTINGS, total: 25, participationPoints: 0 }
    const none = computeCa(settings, {
      attendance: { present: 0, partial: 0, absent: 0 },
      assignments: [],
      participationNet: 0,
      classStarted: ALL_STARTED,
    })
    const ws = (
      await read(
        await buildCaWorkbook({
          settings,
          rows: [student({ name: 'Ada', matricule: 'UB1', result: none }, settings)],
          locale: 'en',
          courseLabel: 'x',
        }),
      )
    ).getWorksheet('CA')!
    const row = ws.getRow(2)
    expect([3, 4, 5, 6].map((c) => row.getCell(c).value)).toEqual([null, null, 0, 'Not assessed: no part applies to this student yet'])
  })

  it('does not turn a spreadsheet formula in a name into a formula', async () => {
    const ws = (
      await read(
        await buildCaWorkbook({
          settings: DEFAULT_SETTINGS,
          rows: [student({ name: '=HYPERLINK("http://x")', matricule: 'UB1' })],
          locale: 'en',
          courseLabel: 'x',
        }),
      )
    ).getWorksheet('CA')!
    expect(ws.getRow(2).getCell(2).value).toBe('=HYPERLINK("http://x")')
  })

  it('writes a header-only sheet for an empty roster', async () => {
    const ws = (await read(await buildCaWorkbook({ settings: DEFAULT_SETTINGS, rows: [], locale: 'en', courseLabel: 'x' }))).getWorksheet('CA')!
    expect(ws.rowCount).toBe(1)
  })
})

describe('exportFileName', () => {
  const at = new Date('2026-11-08T23:30:00Z') // 00:30 on the 9th in Douala (UTC+1)
  it('is CA-<label>-<date in the app time zone>.xlsx', () => {
    expect(exportFileName('CS301', at, 'Africa/Douala')).toBe('CA-CS301-2026-11-09.xlsx')
    expect(exportFileName('CS301', at, 'UTC')).toBe('CA-CS301-2026-11-08.xlsx')
  })
  it('sanitises path separators, quotes and control characters, keeping accents', () => {
    expect(exportFileName('Algo / "TD": été\r\n.', at, 'UTC')).toBe('CA-Algo-TD-été-2026-11-08.xlsx')
    expect(exportFileName('../../etc/passwd', at, 'UTC')).not.toMatch(/[/\\]/)
  })
  it('falls back when the label is empty and caps long labels', () => {
    expect(exportFileName('  /// ', at, 'UTC')).toBe('CA-course-2026-11-08.xlsx')
    expect(exportFileName('x'.repeat(300), at, 'UTC').length).toBeLessThanOrEqual(100)
  })
})
