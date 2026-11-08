import { z } from 'zod'
import type { Block } from '@/server/assignments/rich-text'

/** An id argument: a non-empty string. */
export const id = (description: string) => z.string().min(1).describe(description)

/** A date as ISO 8601, null stays null. */
export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null
}

/** Rounds a ratio or score for an assistant to read (3 decimals is plenty). */
export function round(n: number | null, decimals = 3): number | null {
  if (n === null) return null
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

const MAX_DEPTH = 40

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The text of a block's inline content: text runs, links (their text) and table cells. */
function inlineText(content: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => inlineText(c, depth + 1)).join('')
  if (!isRecord(content)) return ''
  if (typeof content.text === 'string') return content.text
  if (content.type === 'tableContent' && Array.isArray(content.rows)) {
    return content.rows
      .map((row) => (isRecord(row) && Array.isArray(row.cells) ? row.cells.map((c) => inlineText(c, depth + 2)).join(' | ') : ''))
      .join('\n')
  }
  if (content.type === 'tableCell') return inlineText(content.content, depth + 1)
  return inlineText(content.content, depth + 1)
}

function blockLines(blocks: Block[], indent: string, depth: number): string[] {
  if (depth > MAX_DEPTH) return []
  const lines: string[] = []
  let number = 0
  for (const b of blocks) {
    number = b.type === 'numberedListItem' ? number + 1 : 0
    const text = inlineText(b.content)
    const props = isRecord(b.props) ? b.props : {}
    let line: string | null
    switch (b.type) {
      case 'heading':
        line = `${'#'.repeat(typeof props.level === 'number' ? Math.min(Math.max(props.level, 1), 6) : 1)} ${text}`
        break
      case 'bulletListItem':
        line = `- ${text}`
        break
      case 'numberedListItem':
        line = `${number}. ${text}`
        break
      case 'checkListItem':
        line = `[${props.checked === true ? 'x' : ' '}] ${text}`
        break
      case 'quote':
        line = `> ${text}`
        break
      case 'image':
      case 'file':
      case 'video':
      case 'audio': {
        // The media's name or caption only; its URL is not for the assistant.
        const name = [props.name, props.caption].find((v) => typeof v === 'string' && v.trim() !== '')
        line = `[${b.type}${name ? `: ${name as string}` : ''}]`
        break
      }
      default:
        line = text
    }
    if (line !== null) {
      for (const l of line.split('\n')) lines.push(indent + l)
    }
    if (Array.isArray(b.children) && b.children.length > 0) lines.push(...blockLines(b.children, `${indent}  `, depth + 1))
  }
  return lines
}

/**
 * Plain text of a rich-text document (BlockNote blocks): one line per block, lists and headings
 * marked like Markdown, children indented, media as `[image: name]`. Not a block list → ''.
 */
export function richTextToPlain(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blockLines(blocks as Block[], '', 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
