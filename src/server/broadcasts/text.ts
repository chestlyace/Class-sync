/** One piece of a line of an announcement: plain text, or a link to a web address found in the text. */
export type Inline = { kind: 'text'; value: string } | { kind: 'link'; href: string }

const URL_RUN = /https?:\/\/[^\s<>"']+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function lineToPieces(line: string): Inline[] {
  const pieces: Inline[] = []
  const pushText = (value: string) => {
    if (!value) return
    const last = pieces[pieces.length - 1]
    if (last?.kind === 'text') last.value += value
    else pieces.push({ kind: 'text', value })
  }
  let cursor = 0
  for (const match of line.matchAll(URL_RUN)) {
    const start = match.index
    const run = match[0]
    const href = run.replace(TRAILING_PUNCTUATION, '')
    pushText(line.slice(cursor, start))
    if (isWebUrl(href)) {
      pieces.push({ kind: 'link', href })
      pushText(run.slice(href.length))
    } else {
      pushText(run)
    }
    cursor = start + run.length
  }
  pushText(line.slice(cursor))
  return pieces
}

/**
 * An announcement body as paragraphs of lines of pieces. A blank line starts a new paragraph, a single
 * line break stays a line break, and only `http://` and `https://` addresses become links (the
 * punctuation that ends a sentence stays outside the link). Everything else is plain text, so the
 * template escapes it: no markup, no `javascript:` or `mailto:` links.
 */
export function bodyToParagraphs(body: string): Inline[][][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ''))
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => paragraph.split('\n').map(lineToPieces))
}
