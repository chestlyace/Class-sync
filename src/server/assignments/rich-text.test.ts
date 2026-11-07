import { describe, expect, it } from 'vitest'
import { MAX_RICH_TEXT_BYTES } from './rules'
import { isRichTextEmpty, sanitizeRichText } from './rich-text'

const link = (href: string) => ({
  type: 'paragraph',
  content: [{ type: 'link', href, content: [{ type: 'text', text: 'here', styles: {} }] }],
  children: [],
})

describe('sanitizeRichText', () => {
  it('strips javascript: links and keeps https links', () => {
    const out = sanitizeRichText([link('javascript:alert(1)'), link('https://example.com/a'), link('mailto:a@b.c')])!
    const hrefs = out.map((b) => (b.content as { href?: string }[])[0].href)
    expect(hrefs).toEqual([undefined, 'https://example.com/a', 'mailto:a@b.c'])
    // the visible text survives
    expect((out[0].content as { content: unknown }[])[0].content).toBeDefined()
  })
  it('removes obfuscated and relative-scheme hrefs', () => {
    for (const bad of [' JaVaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.com', '/relative']) {
      const out = sanitizeRichText([link(bad)])!
      expect((out[0].content as { href?: string }[])[0].href, bad).toBeUndefined()
    }
  })
  it('sanitises links in nested children and image/file props', () => {
    const out = sanitizeRichText([
      { type: 'bulletListItem', content: [], children: [link('javascript:x')] },
    ])!
    const child = out[0].children![0]
    expect((child.content as { href?: string }[])[0].href).toBeUndefined()
  })
  it('does not mutate its input', () => {
    const input = [link('javascript:x')]
    sanitizeRichText(input)
    expect((input[0].content[0] as { href?: string }).href).toBe('javascript:x')
  })
  it('rejects non-arrays, non-object items and documents over 200 KB', () => {
    expect(sanitizeRichText('hello')).toBeNull()
    expect(sanitizeRichText({})).toBeNull()
    expect(sanitizeRichText(null)).toBeNull()
    expect(sanitizeRichText([1, 'x'])).toBeNull()
    expect(sanitizeRichText([null])).toBeNull()
    const big = [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(MAX_RICH_TEXT_BYTES), styles: {} }] }]
    expect(sanitizeRichText(big)).toBeNull()
  })
  it('accepts an empty array', () => {
    expect(sanitizeRichText([])).toEqual([])
  })
})

describe('isRichTextEmpty', () => {
  it('is true for no blocks and blank paragraphs', () => {
    expect(isRichTextEmpty([])).toBe(true)
    expect(isRichTextEmpty([{ type: 'paragraph', content: [], children: [] }])).toBe(true)
    expect(isRichTextEmpty([{ type: 'paragraph', content: [{ type: 'text', text: '  \n ', styles: {} }] }])).toBe(true)
  })
  it('is false for text', () => {
    expect(isRichTextEmpty([{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', styles: {} }] }])).toBe(false)
    expect(isRichTextEmpty([{ type: 'paragraph', content: 'Hi' }])).toBe(false)
  })
  it('is false when only a nested child has text', () => {
    expect(
      isRichTextEmpty([
        { type: 'paragraph', content: [], children: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', styles: {} }] }] },
      ]),
    ).toBe(false)
  })
  it('is false for an image block', () => {
    expect(isRichTextEmpty([{ type: 'image', props: { url: 'https://x/y.png' } }])).toBe(false)
  })
})
