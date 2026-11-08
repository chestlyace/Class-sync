import type { Block } from '@/server/assignments/rich-text'

/**
 * Plain text or simple markdown → the rich-text JSON the editor stores (BlockNote blocks). Covers
 * what an assistant writes: `#`–`###` headings, paragraphs (lines joined), `-`/`*`/`+` and `1.`
 * lists (indented items nest), `[ ]`/`[x]` check items, `>` quotes, fenced code, and inline
 * **bold**, *italic*, `code`, ~~strike~~ and [links](https://…). Anything else stays as text.
 * The result still goes through `sanitizeRichText` in the services.
 */

type Styles = { bold?: true; italic?: true; code?: true; strike?: true }
type TextItem = { type: 'text'; text: string; styles: Styles }
type LinkItem = { type: 'link'; href: string; content: TextItem[] }
type Inline = TextItem | LinkItem

const SAFE_LINK = /^(https?:\/\/|mailto:)/i
const ESCAPABLE = '\\`*_~[]()#>-'
/** Characters that can start inline markup; everything else is copied as is. */
const SPECIAL = /[\\`*_~[]/

/** Longest source parsed; the tools cap their inputs lower. Everything below is linear in it. */
export const MARKDOWN_MAX = 200_000

const WHITESPACE = /\s/
const isSpace = (c: string) => c === ' ' || WHITESPACE.test(c)

type InlineState = {
  source: string
  styles: Styles
  out: Inline[]
  i: number
  textStart: number
  /** Last index found per closing marker (-1: none left, -2: not searched yet); searches only move forward. */
  found: Record<Needle, number>
  /** Where a link URL after `](` ends (its `)`), or -1; keyed by the `]`, so each is scanned once. */
  urlEnds: Map<number, number> | null
}

type Needle = '**' | '__' | '~~' | '*' | '_' | '`' | ']'

function nextIndex(st: InlineState, needle: Needle, from: number): number {
  const hit = st.found[needle]
  if (hit === -1 || hit >= from) return hit
  const at = st.source.indexOf(needle, from)
  st.found[needle] = at
  return at
}

function flushTo(st: InlineState, end: number): void {
  if (end > st.textStart) st.out.push({ type: 'text', text: st.source.slice(st.textStart, end), styles: { ...st.styles } })
}

/** `marker` text `marker` → styled inline items; false when unclosed or empty. */
function pair(st: InlineState, marker: Needle, style: keyof Styles): boolean {
  const { source, i } = st
  if (st.styles[style] || !source.startsWith(marker, i)) return false
  const from = i + marker.length
  // An empty pair (`****`) is text; checked first so a run of markers costs no search.
  if (source.startsWith(marker, from)) return false
  const end = nextIndex(st, marker, from)
  if (end <= from) return false
  flushTo(st, i)
  for (const item of parseInline(source.slice(from, end), { ...st.styles, [style]: true })) st.out.push(item)
  st.i = st.textStart = end + marker.length
  return true
}

/** `[text](https://…)` → a link; false unless it is a complete link with a safe URL. */
function link(st: InlineState): boolean {
  const { source, i } = st
  const close = nextIndex(st, ']', i + 1)
  if (close <= i + 1 || source[close + 1] !== '(') return false
  st.urlEnds ??= new Map()
  let end = st.urlEnds.get(close)
  if (end === undefined) {
    end = -1
    for (let k = close + 2; k < source.length; k++) {
      if (source[k] === ')') {
        if (k > close + 2) end = k
        break
      }
      if (isSpace(source[k])) break
    }
    st.urlEnds.set(close, end)
  }
  if (end < 0) return false
  const href = source.slice(close + 2, end)
  if (!SAFE_LINK.test(href)) return false
  flushTo(st, i)
  const content = parseInline(source.slice(i + 1, close), st.styles).flatMap((item) =>
    item.type === 'text' ? [item] : item.content,
  )
  st.out.push({ type: 'link', href, content })
  st.i = st.textStart = end + 1
  return true
}

/**
 * Inline markdown → BlockNote inline content. Unclosed markers stay as plain text. One left-to-
 * right scan with no backtracking: every search for a closing marker only moves forward, and each
 * style (bold, italic, strike, code, link text) nests at most once, so it stays linear whatever
 * the input.
 */
export function parseInline(source: string, styles: Styles = {}): Inline[] {
  if (!SPECIAL.test(source)) return source ? [{ type: 'text', text: source, styles: { ...styles } }] : []
  const st: InlineState = {
    source,
    styles,
    out: [],
    i: 0,
    textStart: 0,
    found: { '**': -2, __: -2, '~~': -2, '*': -2, _: -2, '`': -2, ']': -2 },
    urlEnds: null,
  }
  while (st.i < source.length) {
    const c = source[st.i]
    if (c !== '\\' && c !== '[' && source[st.i + 1] === c) {
      // Inside a run of one marker (`*****`), any pair opened before its last three characters
      // would be empty, so it is plain text: jump there instead of trying each position.
      let end = st.i + 2
      while (end < source.length && source[end] === c) end++
      if (end - 3 > st.i) st.i = end - 3
    }
    const i = st.i
    switch (source[i]) {
      case '\\':
        if (i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
          // The escaped character starts the next run of plain text.
          flushTo(st, i)
          st.textStart = i + 1
          st.i = i + 2
          continue
        }
        break
      case '`':
        if (!styles.code && source[i + 1] !== '`') {
          const end = nextIndex(st, '`', i + 1)
          if (end > i + 1) {
            flushTo(st, i)
            st.out.push({ type: 'text', text: source.slice(i + 1, end), styles: { ...styles, code: true } })
            st.i = st.textStart = end + 1
            continue
          }
        }
        break
      case '*':
        if (pair(st, '**', 'bold') || (source[i + 1] !== ' ' && pair(st, '*', 'italic'))) continue
        break
      case '_':
        if (pair(st, '__', 'bold') || (source[i + 1] !== ' ' && pair(st, '_', 'italic'))) continue
        break
      case '~':
        if (pair(st, '~~', 'strike')) continue
        break
      case '[':
        if (link(st)) continue
        break
    }
    st.i = i + 1
  }
  flushTo(st, source.length)
  return st.out
}

const block = (type: string, content: Inline[] | string, props: Record<string, unknown> = {}): Block => ({
  type,
  props,
  content,
  children: [],
})

type ListItem = { indent: number; block: Block }

const LIST_DEPTH_MAX = 8

/** Nests list items by indentation: a deeper item becomes a child of the item above it. */
function nestList(items: ListItem[]): Block[] {
  const roots: Block[] = []
  const stack: ListItem[] = []
  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) stack.pop()
    // Deeper than the editor (and the sanitiser) allow: a sibling at the deepest level instead.
    while (stack.length >= LIST_DEPTH_MAX) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.block.children!.push(item.block)
    else roots.push(item.block)
    stack.push(item)
  }
  return roots
}

// Each quantifier is followed by a character class it cannot overlap (or by `[\s\S]*$`, which
// always matches), so none of these can backtrack more than linearly.
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+([\s\S]*)$/
const CHECK = /^\[( |x|X)\]\s+([\s\S]*)$/
const HEADING = /^\s*(#{1,6})\s+([\s\S]*)$/
const QUOTE = /^\s*>\s?([\s\S]*)$/
const FENCE_INFO = /^[\w+-]*$/

/** A heading's text without the optional closing `#`s and trailing spaces (no regex: linear). */
function headingText(raw: string): string {
  let end = raw.length
  while (end > 0 && isSpace(raw[end - 1])) end--
  const beforeHashes = end
  while (end > 0 && raw[end - 1] === '#') end--
  // `# C#` keeps its `#`: closing hashes must stand apart from the text.
  if (end < beforeHashes && end > 0 && !isSpace(raw[end - 1])) end = beforeHashes
  while (end > 0 && isSpace(raw[end - 1])) end--
  return raw.slice(0, end)
}

/** The line's first non-space character (undefined for a blank line), without copying it. */
function firstVisible(line: string): string | undefined {
  for (let k = 0; k < line.length; k++) if (!isSpace(line[k])) return line[k]
  return undefined
}

/** "```js" → { marker, info } when the line opens or closes a fence. */
function fenceOf(line: string): { marker: string; info: string } | null {
  const trimmed = line.trim()
  const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : null
  if (!marker) return null
  const info = trimmed.slice(3).trim()
  return FENCE_INFO.test(info) ? { marker, info } : null
}

export function markdownToBlocks(source: string): Block[] {
  const lines = source.slice(0, MARKDOWN_MAX).split(/\r\n?|[\n\u2028\u2029]/)
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: ListItem[] = []

  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push(block('paragraph', parseInline(paragraph.join(' '))))
    paragraph = []
  }
  const endList = () => {
    for (const b of nestList(list)) blocks.push(b)
    list = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const first = firstVisible(line)
    const fence = first === '`' || first === '~' ? fenceOf(line) : null
    if (fence) {
      endParagraph()
      endList()
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(fence.marker)) code.push(lines[i++])
      blocks.push(block('codeBlock', code.join('\n'), fence.info ? { language: fence.info } : {}))
      continue
    }
    if (first === undefined) {
      endParagraph()
      endList()
      continue
    }
    const heading = first === '#' ? HEADING.exec(line) : null
    if (heading) {
      endParagraph()
      endList()
      blocks.push(
        block('heading', parseInline(headingText(heading[2])), {
          level: Math.min(heading[1].length, 3),
        }),
      )
      continue
    }
    const quote = first === '>' ? QUOTE.exec(line) : null
    if (quote) {
      endParagraph()
      endList()
      blocks.push(block('quote', parseInline(quote[1])))
      continue
    }
    const item = first === '-' || first === '*' || first === '+' || (first >= '0' && first <= '9') ? LIST_ITEM.exec(line) : null
    if (item) {
      endParagraph()
      const indent = item[1].replace(/\t/g, '    ').length
      const check = CHECK.exec(item[3])
      const b = check
        ? block('checkListItem', parseInline(check[2]), {
            checked: check[1] !== ' ',
          })
        : block(/\d/.test(item[2]) ? 'numberedListItem' : 'bulletListItem', parseInline(item[3]))
      list.push({ indent, block: b })
      continue
    }
    if (list.length > 0 && /^\s+\S/.test(line)) {
      // A continuation line of the list item above.
      const last = list[list.length - 1].block
      for (const item of parseInline(' ' + line.trim())) (last.content as Inline[]).push(item)
      continue
    }
    endList()
    paragraph.push(line.trim())
  }
  endParagraph()
  endList()
  return blocks.length > 0 ? blocks : [block('paragraph', [])]
}
