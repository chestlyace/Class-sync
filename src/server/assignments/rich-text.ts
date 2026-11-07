import { MAX_RICH_TEXT_BYTES } from './rules'

/** Minimal shape of a rich-text block; deliberately not BlockNote's type so the server doesn't depend on the editor. */
export type Block = {
  type: string
  content?: unknown
  children?: Block[]
  props?: Record<string, unknown>
}

const MAX_DEPTH = 40
const SAFE_HREF = /^(https?:|mailto:)/i

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSafeHref(href: string): boolean {
  // Browsers ignore tabs, newlines and other control characters inside a URL scheme.
  const compact = href.replace(/[\u0000- \u007f-\u009f]/g, '')
  return SAFE_HREF.test(compact)
}

/** Copy of `value` with every `href` that isn't http(s)/mailto dropped. Returns undefined when nested too deeply. */
function clean(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value) {
      const c = clean(item, depth + 1)
      if (c === undefined && item !== undefined) return undefined
      out.push(c)
    }
    return out
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'href' && (typeof v !== 'string' || !isSafeHref(v))) continue
      const c = clean(v, depth + 1)
      if (c === undefined && v !== undefined) return undefined
      out[k] = c
    }
    return out
  }
  return value
}

/** A sanitised copy of a rich-text document, or null if it isn't an array of block objects or is too large. */
export function sanitizeRichText(value: unknown): Block[] | null {
  if (!Array.isArray(value) || !value.every(isRecord)) return null
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    return null
  }
  if (new TextEncoder().encode(json).length > MAX_RICH_TEXT_BYTES) return null
  const out = clean(JSON.parse(json), 0)
  return Array.isArray(out) ? (out as Block[]) : null
}

const TEXT_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'codeBlock',
])

function hasText(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.some((v) => hasText(v, depth + 1))
  if (isRecord(value)) {
    if (typeof value.text === 'string' && value.text.trim() !== '') return true
    return hasText(value.content, depth + 1) || hasText(value.rows, depth + 1) || hasText(value.cells, depth + 1)
  }
  return false
}

/** True when there is no visible text and no non-text block (image, file, table, ...). */
export function isRichTextEmpty(blocks: Block[]): boolean {
  return blocks.every((b) => {
    if (!TEXT_BLOCK_TYPES.has(b.type)) return false
    return !hasText(b.content) && isRichTextEmpty(b.children ?? [])
  })
}
