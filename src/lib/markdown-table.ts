/**
 * Markdown (GFM) tables, written with pipes and dashes:
 *
 *   | Name | Mark |
 *   | :--- | ---: |
 *   | Ada  | 18   |
 *
 * Pure helpers with no editor import, used by the Markdown importer (MCP drafts) and by the
 * rich-text viewer, which turns table text already stored as paragraphs into real tables.
 */

export type Align = 'left' | 'center' | 'right'

/** Widest table read; wider ones stay as text. */
export const TABLE_MAX_COLUMNS = 30

type Rec = Record<string, unknown>

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `| a | b \| c |` → ['a', 'b | c']: split on unescaped pipes, outer pipes dropped, cells trimmed. */
export function splitTableRow(line: string): string[] {
  const cells: string[] = ['']
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '|') {
      cells[cells.length - 1] += '|'
      i++
    } else if (c === '|') {
      cells.push('')
    } else {
      cells[cells.length - 1] += c
    }
  }
  return dropOuter(
    cells.map((cell) => cell.trim()),
    line.trim(),
  )
}

/** Drops the empty cell before a leading pipe and after a trailing one. */
function dropOuter<T>(cells: T[], trimmedLine: string): T[] {
  let out = cells
  if (trimmedLine.startsWith('|')) out = out.slice(1)
  if (trimmedLine.endsWith('|') && !trimmedLine.endsWith('\\|') && out.length > 0) out = out.slice(0, -1)
  return out
}

const SEPARATOR_CELL = /^:?-+:?$/

function alignOf(cell: string): Align {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  return left && right ? 'center' : right ? 'right' : 'left'
}

/** `| :--- | ---: |` → ['left', 'right']; null when the line isn't a table's separator row. */
export function separatorAligns(line: string): Align[] | null {
  // A separator row always has a pipe; a bare `---` is a rule, not a one-column table.
  if (!line.includes('|') || !line.includes('-') || !/^[\s|:-]+$/.test(line)) return null
  const cells = splitTableRow(line)
  if (cells.length === 0 || cells.length > TABLE_MAX_COLUMNS || !cells.every((c) => SEPARATOR_CELL.test(c))) return null
  return cells.map(alignOf)
}

/** The column alignments when `header` and `separator` open a table (same column count), else null. */
export function tableStart(header: string, separator: string): Align[] | null {
  if (!header.includes('|')) return null
  const aligns = separatorAligns(separator)
  return aligns && splitTableRow(header).length === aligns.length ? aligns : null
}

/** A row padded with empty cells or cut to the table's width, as GFM does. */
export function fitRow<T>(cells: T[], width: number, empty: () => T): T[] {
  const out = cells.slice(0, width)
  while (out.length < width) out.push(empty())
  return out
}

/** A BlockNote table block: the first row is the header, cells aligned per column. */
export function tableBlock(rows: unknown[][], aligns: Align[]) {
  return {
    type: 'table',
    props: {},
    content: {
      type: 'tableContent',
      headerRows: 1,
      rows: rows.map((cells) => ({
        cells: cells.map((content, i) => ({
          type: 'tableCell',
          props: aligns[i] && aligns[i] !== 'left' ? { textAlignment: aligns[i] } : {},
          content,
        })),
      })),
    },
    children: [],
  }
}

// ---------------------------------------------------------------------------------------------
// Table text already stored as paragraphs (drafts made before tables were read, or a table typed
// line by line in the editor) → real tables, when the document is shown or edited.

/** Stands in for a link in a paragraph's text: never a pipe or a dash. */
const LINK_MARK = '\u0000'

/** A paragraph's text, or null for any other block or one with children. */
function paragraphText(block: unknown): string | null {
  if (!isRecord(block) || block.type !== 'paragraph') return null
  if (Array.isArray(block.children) && block.children.length > 0) return null
  const content = block.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  let text = ''
  for (const item of content) {
    if (typeof item === 'string') text += item
    else if (isRecord(item) && typeof item.text === 'string') text += item.text
    else text += LINK_MARK
  }
  return text
}

/** Inline content split into cells on unescaped pipes; styles and links stay with their cell. */
function splitInlineCells(content: unknown): Rec[][] {
  const items: unknown[] = typeof content === 'string' ? [content] : Array.isArray(content) ? content : []
  const cells: Rec[][] = [[]]
  const push = (item: Rec) => cells[cells.length - 1].push(item)
  for (const raw of items) {
    const item: unknown = typeof raw === 'string' ? { type: 'text', text: raw, styles: {} } : raw
    if (!isRecord(item)) continue
    if (item.type !== 'text' || typeof item.text !== 'string') {
      push(item)
      continue
    }
    const text = item.text
    let part = ''
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\\' && text[i + 1] === '|') {
        part += '|'
        i++
      } else if (text[i] === '|') {
        if (part) push({ ...item, text: part })
        part = ''
        cells.push([])
      } else {
        part += text[i]
      }
    }
    if (part) push({ ...item, text: part })
  }
  return cells.map(trimCell)
}

/** A cell's inline items without leading and trailing whitespace. */
function trimCell(cell: Rec[]): Rec[] {
  const out = cell.map((item) => ({ ...item }))
  while (out.length > 0 && typeof out[0].text === 'string') {
    out[0].text = (out[0].text as string).trimStart()
    if (out[0].text) break
    out.shift()
  }
  while (out.length > 0 && typeof out[out.length - 1].text === 'string') {
    const last = out[out.length - 1]
    last.text = (last.text as string).trimEnd()
    if (last.text) break
    out.pop()
  }
  return out
}

const rowCells = (block: Rec, text: string) => dropOuter(splitInlineCells(block.content), text.trim())

/** Consecutive paragraphs, one table row each: header, separator, then the rows with a pipe. */
function rowsTable(blocks: unknown[], start: number): { block: Rec; next: number } | null {
  const header = paragraphText(blocks[start])
  const separator = start + 1 < blocks.length ? paragraphText(blocks[start + 1]) : null
  if (header === null || separator === null) return null
  const aligns = tableStart(header, separator)
  if (!aligns) return null
  const width = aligns.length
  const rows: Rec[][][] = [fitRow(rowCells(blocks[start] as Rec, header), width, () => [])]
  let next = start + 2
  for (; next < blocks.length; next++) {
    const text = paragraphText(blocks[next])
    if (text === null || !text.includes('|')) break
    rows.push(fitRow(rowCells(blocks[next] as Rec, text), width, () => []))
  }
  return { block: tableBlock(rows, aligns), next }
}

const cellText = (cell: Rec[]) => cell.map((item) => (typeof item.text === 'string' ? item.text : LINK_MARK)).join('')

/**
 * A whole table joined into one paragraph (`| a | b | | --- | --- | | 1 | 2 |`), as drafts stored
 * it before tables were read. Only rows written with outer pipes can be told apart: each row break
 * is the empty cell between one row's closing pipe and the next row's opening one.
 */
function joinedTable(block: unknown): Rec | null {
  const text = paragraphText(block)
  if (text === null) return null
  const trimmed = text.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || !trimmed.includes('-')) return null
  const cells = dropOuter(splitInlineCells((block as Rec).content), trimmed)
  for (let width = 1; width <= TABLE_MAX_COLUMNS && 2 * width + 1 <= cells.length; width++) {
    if (cells[width].length > 0) continue
    const separator = cells.slice(width + 1, 2 * width + 1).map(cellText)
    if (!separator.every((c) => SEPARATOR_CELL.test(c))) continue
    if ((cells.length - width) % (width + 1) !== 0) continue
    const rows: Rec[][][] = [cells.slice(0, width)]
    let ok = true
    for (let at = 2 * width + 1; ok && at < cells.length; at += width + 1) {
      if (cells[at].length > 0) ok = false
      else rows.push(cells.slice(at + 1, at + 1 + width))
    }
    if (ok) return tableBlock(rows, separator.map(alignOf))
  }
  return null
}

/** The document with Markdown table text in its paragraphs turned into table blocks (same array when there is none). */
export function upgradeTextTables<T>(blocks: T[]): T[] {
  const out: unknown[] = []
  let changed = false
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const rows = rowsTable(blocks, i)
    if (rows) {
      out.push(rows.block)
      i = rows.next - 1
      changed = true
      continue
    }
    const joined = joinedTable(block)
    if (joined) {
      out.push(joined)
      changed = true
      continue
    }
    if (isRecord(block) && Array.isArray(block.children) && block.children.length > 0) {
      const children = upgradeTextTables(block.children)
      if (children !== block.children) {
        out.push({ ...block, children })
        changed = true
        continue
      }
    }
    out.push(block)
  }
  return changed ? (out as T[]) : blocks
}
