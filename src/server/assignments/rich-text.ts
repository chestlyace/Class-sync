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
const SAFE_URL = /^https?:/i
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function matchesScheme(value: string, allowed: RegExp): boolean {
  // Browsers ignore tabs, newlines and other control characters inside a URL scheme.
  return allowed.test(value.replace(/[\u0000- \u007f-\u009f]/g, ''))
}

const isSafeHref = (v: unknown): v is string => typeof v === 'string' && matchesScheme(v, SAFE_HREF)
const isSafeUrl = (v: unknown): v is string => typeof v === 'string' && matchesScheme(v, SAFE_URL)

/** Children of a link whose href was removed: its text content, as inline items. */
function unwrapLink(content: unknown): unknown[] {
  if (typeof content === 'string') return content === '' ? [] : [{ type: 'text', text: content, styles: {} }]
  return Array.isArray(content) ? content : []
}

/**
 * Copy of any JSON value with unsafe hrefs dropped (links with no safe href are unwrapped to their text) and
 * prototype-polluting keys skipped. Returns undefined when nested deeper than MAX_DEPTH.
 */
function cleanValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value) {
      if (isRecord(item) && item.type === 'link' && !isSafeHref(item.href)) {
        const inner = cleanValue(unwrapLink(item.content), depth + 1)
        if (inner === undefined) return undefined
        out.push(...(inner as unknown[]))
        continue
      }
      const c = cleanValue(item, depth + 1)
      if (c === undefined && item !== undefined) return undefined
      out.push(c)
    }
    return out
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue
      if (k === 'href' && !isSafeHref(v)) continue
      const c = cleanValue(v, depth + 1)
      if (c === undefined && v !== undefined) return undefined
      out[k] = c
    }
    return out
  }
  return value
}

/** Validates and copies a block list: every block needs a string `type`, array `children`, record `props`. */
function cleanBlocks(value: unknown, depth: number): Block[] | null {
  if (depth > MAX_DEPTH || !Array.isArray(value)) return null
  const out: Block[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.type !== 'string') return null
    const block: Record<string, unknown> = { type: raw.type }
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'type' || FORBIDDEN_KEYS.has(k)) continue
      if (k === 'children') {
        if (v === undefined) continue
        const kids = cleanBlocks(v, depth + 1)
        if (!kids) return null
        block.children = kids
      } else if (k === 'props') {
        if (v === undefined) continue
        if (!isRecord(v)) return null
        const props = cleanValue(v, depth + 1) as Record<string, unknown> | undefined
        if (!props) return null
        // Media blocks (image/file/video/audio) point at http(s) URLs only.
        if ('url' in props && !isSafeUrl(props.url)) delete props.url
        block.props = props
      } else {
        const c = cleanValue(v, depth + 1)
        if (c === undefined && v !== undefined) return null
        block[k] = c
      }
    }
    out.push(block as Block)
  }
  return out
}

/** A sanitised copy of a rich-text document, or null if it isn't a valid block list or is too large/deep. */
export function sanitizeRichText(value: unknown): Block[] | null {
  if (!Array.isArray(value)) return null
  let json: string
  try {
    // Throws on cycles, BigInt, and structures too deep for the engine.
    json = JSON.stringify(value)
  } catch {
    return null
  }
  if (new TextEncoder().encode(json).length > MAX_RICH_TEXT_BYTES) return null
  return cleanBlocks(JSON.parse(json), 0)
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
    return !hasText(b.content) && isRichTextEmpty(Array.isArray(b.children) ? b.children : [])
  })
}
