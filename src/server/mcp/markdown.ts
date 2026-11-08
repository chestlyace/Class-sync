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

/** Inline markdown → BlockNote inline content. Unclosed markers stay as plain text. */
export function parseInline(source: string, styles: Styles = {}): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer, styles: { ...styles } })
    buffer = ''
  }
  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_~[\]()#>-]/.test(rest[1])) {
      buffer += rest[1]
      i += 2
      continue
    }
    if (rest[0] === '`' && !styles.code) {
      const end = rest.indexOf('`', 1)
      if (end > 1) {
        flush()
        out.push({ type: 'text', text: rest.slice(1, end), styles: { ...styles, code: true } })
        i += end + 1
        continue
      }
    }
    const pair = (marker: string, style: keyof Styles) => {
      if (!rest.startsWith(marker) || styles[style]) return false
      const end = rest.indexOf(marker, marker.length)
      if (end <= marker.length) return false
      flush()
      out.push(...parseInline(rest.slice(marker.length, end), { ...styles, [style]: true }))
      i += end + marker.length
      return true
    }
    if (pair('**', 'bold') || pair('__', 'bold') || pair('~~', 'strike')) continue
    if ((rest[0] === '*' || rest[0] === '_') && rest[1] !== ' ' && pair(rest[0], 'italic')) continue
    if (rest[0] === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
      if (m && SAFE_LINK.test(m[2])) {
        flush()
        const content = parseInline(m[1], styles).flatMap((item) => (item.type === 'text' ? [item] : item.content))
        out.push({ type: 'link', href: m[2], content })
        i += m[0].length
        continue
      }
    }
    buffer += rest[0]
    i += 1
  }
  flush()
  return out
}

const block = (type: string, content: Inline[] | string, props: Record<string, unknown> = {}): Block => ({
  type,
  props,
  content,
  children: [],
})

type ListItem = { indent: number; block: Block }

/** Nests list items by indentation: a deeper item becomes a child of the item above it. */
function nestList(items: ListItem[]): Block[] {
  const roots: Block[] = []
  const stack: ListItem[] = []
  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.block.children!.push(item.block)
    else roots.push(item.block)
    stack.push(item)
  }
  return roots
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const CHECK = /^\[( |x|X)\]\s+(.*)$/

export function markdownToBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: ListItem[] = []

  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push(block('paragraph', parseInline(paragraph.join(' '))))
    paragraph = []
  }
  const endList = () => {
    if (list.length > 0) blocks.push(...nestList(list))
    list = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      endParagraph()
      endList()
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++])
      blocks.push(block('codeBlock', code.join('\n'), fence[2] ? { language: fence[2] } : {}))
      continue
    }
    if (line.trim() === '') {
      endParagraph()
      endList()
      continue
    }
    const heading = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      endParagraph()
      endList()
      blocks.push(block('heading', parseInline(heading[2]), { level: Math.min(heading[1].length, 3) }))
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      endParagraph()
      endList()
      blocks.push(block('quote', parseInline(quote[1])))
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item) {
      endParagraph()
      const indent = item[1].replace(/\t/g, '    ').length
      const check = CHECK.exec(item[3])
      const b = check
        ? block('checkListItem', parseInline(check[2]), { checked: check[1] !== ' ' })
        : block(/\d/.test(item[2]) ? 'numberedListItem' : 'bulletListItem', parseInline(item[3]))
      list.push({ indent, block: b })
      continue
    }
    if (list.length > 0 && /^\s+\S/.test(line)) {
      // A continuation line of the list item above.
      const last = list[list.length - 1].block
      last.content = [...(last.content as Inline[]), ...parseInline(' ' + line.trim())]
      continue
    }
    endList()
    paragraph.push(line.trim())
  }
  endParagraph()
  endList()
  return blocks.length > 0 ? blocks : [block('paragraph', [])]
}
