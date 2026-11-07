/**
 * Pure helpers for stored rich-text documents (BlockNote JSON), with no editor import so they run
 * anywhere (and in unit tests). The editor wrapper passes its schema's names.
 */

export type RichTextSchemaNames = {
  blocks: ReadonlySet<string>
  inline: ReadonlySet<string>
  styles: ReadonlySet<string>
}

type Rec = Record<string, unknown>

const MAX_DEPTH = 40

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Only known style keys, with boolean or string values. */
function filterStyles(styles: unknown, names: RichTextSchemaNames): Rec {
  if (!isRecord(styles)) return {}
  const out: Rec = {}
  for (const [key, value] of Object.entries(styles)) {
    if (names.styles.has(key) && (typeof value === 'boolean' || typeof value === 'string')) out[key] = value
  }
  return out
}

/** Inline items of known types (plain strings stay); unknown ones are dropped. */
function filterInline(items: unknown, names: RichTextSchemaNames, depth: number): unknown[] | string {
  if (typeof items === 'string') return items
  if (!Array.isArray(items) || depth > MAX_DEPTH) return []
  const out: unknown[] = []
  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item)
      continue
    }
    if (!isRecord(item) || typeof item.type !== 'string' || !names.inline.has(item.type)) continue
    if (item.type === 'text') {
      if (typeof item.text !== 'string') continue
      out.push({ ...item, styles: filterStyles(item.styles, names) })
    } else if (item.type === 'link') {
      out.push({ ...item, content: filterInline(item.content, names, depth + 1) })
    } else {
      out.push(item)
    }
  }
  return out
}

/** A table's rows, each cell's inline content filtered (cells are inline arrays or `tableCell`s). */
function filterTable(content: Rec, names: RichTextSchemaNames, depth: number): Rec {
  const rows = Array.isArray(content.rows) ? content.rows : []
  return {
    ...content,
    rows: rows.filter(isRecord).map((row) => ({
      ...row,
      cells: (Array.isArray(row.cells) ? row.cells : []).map((cell: unknown) =>
        isRecord(cell)
          ? { ...cell, content: filterInline(cell.content, names, depth + 1) }
          : filterInline(cell, names, depth + 1),
      ),
    })),
  }
}

/**
 * A copy of the document that BlockNote can load: blocks, inline items and style keys the schema
 * doesn't know are dropped (BlockNote throws on them). Undefined for an empty or invalid value.
 */
export function filterRichText(value: unknown, names: RichTextSchemaNames): Rec[] | undefined {
  function blocks(list: unknown[], depth: number): Rec[] {
    if (depth > MAX_DEPTH) return []
    const out: Rec[] = []
    for (const raw of list) {
      if (!isRecord(raw) || typeof raw.type !== 'string' || !names.blocks.has(raw.type)) continue
      const block: Rec = { ...raw }
      if (Array.isArray(raw.children)) block.children = blocks(raw.children, depth + 1)
      if (isRecord(raw.content) && raw.content.type === 'tableContent') {
        block.content = filterTable(raw.content, names, depth)
      } else if (raw.content !== undefined) {
        block.content = filterInline(raw.content, names, depth)
      }
      out.push(block)
    }
    return out
  }
  if (!Array.isArray(value)) return undefined
  const content = blocks(value, 0)
  return content.length > 0 ? content : undefined
}

/** The document's text, one line per block (for a fallback when the document can't be shown). */
export function richTextPlainText(value: unknown): string {
  const lines: string[] = []
  function inline(content: unknown, depth: number): string {
    if (depth > MAX_DEPTH) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((c) => inline(c, depth + 1)).join('')
    if (isRecord(content)) {
      if (typeof content.text === 'string') return content.text
      if (Array.isArray(content.rows)) {
        return content.rows
          .map((row) => (isRecord(row) && Array.isArray(row.cells) ? row.cells.map((c) => inline(c, depth + 1)).join('\t') : ''))
          .join('\n')
      }
      return inline(content.content, depth + 1)
    }
    return ''
  }
  function walk(list: unknown, depth: number) {
    if (!Array.isArray(list) || depth > MAX_DEPTH) return
    for (const block of list) {
      if (!isRecord(block)) continue
      const text = inline(block.content, depth).trim()
      if (text) lines.push(text)
      walk(block.children, depth + 1)
    }
  }
  walk(value, 0)
  return lines.join('\n')
}
