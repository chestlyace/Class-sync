import { describe, expect, it } from 'vitest'
import { MAX_RICH_TEXT_BYTES } from './rules'
import { isRichTextEmpty, sanitizeRichText } from './rich-text'

const link = (href: string) => ({
  type: 'paragraph',
  content: [{ type: 'link', href, content: [{ type: 'text', text: 'here', styles: {} }] }],
  children: [],
})

const text = (t: string) => ({ type: 'text', text: t, styles: {} })
const para = (t: string) => ({ type: 'paragraph', content: [text(t)], children: [] })
const first = (blocks: { content?: unknown }[] | null, i = 0) => (blocks![i].content as Record<string, unknown>[])[0]

/** A document whose JSON is exactly `bytes` bytes long. */
function docOfBytes(bytes: number) {
  const base = JSON.stringify([para('')]).length
  return [para('x'.repeat(bytes - base))]
}

describe('sanitizeRichText', () => {
  it('strips javascript: links, keeps https and mailto links', () => {
    const out = sanitizeRichText([link('javascript:alert(1)'), link('https://example.com/a'), link('mailto:a@b.c')])!
    expect(first(out, 1).href).toBe('https://example.com/a')
    expect(first(out, 2).href).toBe('mailto:a@b.c')
    // an unsafe link is unwrapped to its plain text, not left as a href-less link
    expect(first(out, 0)).toEqual({ type: 'text', text: 'here', styles: {} })
  })
  it('removes obfuscated and relative-scheme hrefs', () => {
    for (const bad of [' JaVaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.com', '/relative']) {
      const item = first(sanitizeRichText([link(bad)]))
      expect(item.type, bad).toBe('text')
      expect(item.href, bad).toBeUndefined()
    }
  })
  it('unwraps a link with no href at all, and a link whose content is a string', () => {
    const noHref = { type: 'paragraph', content: [{ type: 'link', content: [text('a')] }] }
    expect(first(sanitizeRichText([noHref]))).toEqual(text('a'))
    const strContent = { type: 'paragraph', content: [{ type: 'link', href: 'javascript:x', content: 'plain' }] }
    expect(first(sanitizeRichText([strContent]))).toEqual(text('plain'))
  })
  it('sanitises links in nested children and media props.url', () => {
    const out = sanitizeRichText([
      {
        type: 'bulletListItem',
        content: [],
        children: [link('javascript:x'), link('https://ok.example')],
      },
      { type: 'image', props: { url: 'javascript:alert(1)', caption: 'c' } },
      { type: 'image', props: { url: 'https://cdn.example/a.png' } },
      { type: 'file', props: { url: ' data:text/html,x' } },
      { type: 'video', props: { url: 'mailto:a@b.c' } },
      { type: 'audio', props: { url: 42 } },
    ])!
    expect(first(out[0].children!, 0)).toEqual(text('here'))
    expect(first(out[0].children!, 1).href).toBe('https://ok.example')
    expect(out[1].props).toEqual({ caption: 'c' })
    expect(out[2].props).toEqual({ url: 'https://cdn.example/a.png' })
    expect(out[3].props).toEqual({})
    expect(out[4].props).toEqual({})
    expect(out[5].props).toEqual({})
  })
  it('sanitises links inside table cells', () => {
    const table = {
      type: 'table',
      content: { type: 'tableContent', rows: [{ cells: [[link('javascript:x').content[0]]] }] },
    }
    const out = sanitizeRichText([table])!
    const cell = ((out[0].content as { rows: { cells: Record<string, unknown>[][] }[] }).rows[0].cells[0])[0]
    expect(cell.href).toBeUndefined()
  })
  it('does not mutate its input', () => {
    const input = [link('javascript:x')]
    sanitizeRichText(input)
    expect((input[0].content[0] as { href?: string }).href).toBe('javascript:x')
  })
  it('skips __proto__, constructor and prototype keys', () => {
    const doc = JSON.parse(
      '[{"type":"paragraph","__proto__":{"polluted":1},"constructor":{"x":1},"props":{"__proto__":{"y":1},"prototype":1,"ok":true}}]',
    )
    const out = sanitizeRichText(doc)!
    expect(Object.getPrototypeOf(out[0])).toBe(Object.prototype)
    expect(Object.keys(out[0]).sort()).toEqual(['props', 'type'])
    expect(out[0].props).toEqual({ ok: true })
    expect(Object.getPrototypeOf(out[0].props)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
  it('accepts an empty array', () => {
    expect(sanitizeRichText([])).toEqual([])
  })

  describe('shape', () => {
    it('rejects non-arrays and non-object items', () => {
      expect(sanitizeRichText('hello')).toBeNull()
      expect(sanitizeRichText({})).toBeNull()
      expect(sanitizeRichText(null)).toBeNull()
      expect(sanitizeRichText([1, 'x'])).toBeNull()
      expect(sanitizeRichText([null])).toBeNull()
      expect(sanitizeRichText([[]])).toBeNull()
    })
    it('requires every block to have a string type', () => {
      expect(sanitizeRichText([{}])).toBeNull()
      expect(sanitizeRichText([{ type: 5 }])).toBeNull()
      expect(sanitizeRichText([{ type: null }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', children: [{}] }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', children: [{ type: 'paragraph', children: [{ type: 1 }] }] }])).toBeNull()
    })
    it('requires children to be an array of valid blocks when present', () => {
      expect(sanitizeRichText([{ type: 'paragraph', children: 'x' }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', children: [null] }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', children: {} }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', children: null }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph' }])).toEqual([{ type: 'paragraph' }])
    })
    it('requires props to be a plain record when present', () => {
      expect(sanitizeRichText([{ type: 'paragraph', props: 'x' }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', props: [] }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', props: null }])).toBeNull()
      expect(sanitizeRichText([{ type: 'paragraph', props: { a: 1 } }])).toEqual([{ type: 'paragraph', props: { a: 1 } }])
    })
    it('lets isRichTextEmpty run on anything it returns', () => {
      for (const v of [[{ type: 'paragraph' }], [{ type: 'paragraph', children: [{ type: 'paragraph' }] }]]) {
        expect(isRichTextEmpty(sanitizeRichText(v)!)).toBe(true)
      }
    })
  })

  describe('limits', () => {
    it('accepts exactly 200_000 bytes and rejects 200_001', () => {
      expect(JSON.stringify(docOfBytes(MAX_RICH_TEXT_BYTES)).length).toBe(MAX_RICH_TEXT_BYTES)
      expect(sanitizeRichText(docOfBytes(MAX_RICH_TEXT_BYTES))).not.toBeNull()
      expect(sanitizeRichText(docOfBytes(MAX_RICH_TEXT_BYTES + 1))).toBeNull()
    })
    it('counts bytes, not characters', () => {
      const multibyte = [para('é'.repeat(MAX_RICH_TEXT_BYTES / 2))]
      expect(sanitizeRichText(multibyte)).toBeNull()
    })
    it('rejects block nesting deeper than 40 levels', () => {
      const nest = (levels: number) => {
        let b: Record<string, unknown> = { type: 'paragraph', children: [] }
        for (let i = 0; i < levels; i++) b = { type: 'paragraph', children: [b] }
        return [b]
      }
      expect(sanitizeRichText(nest(10))).not.toBeNull()
      expect(sanitizeRichText(nest(50))).toBeNull()
    })
    it('rejects deep inline nesting', () => {
      let inner: unknown = text('x')
      for (let i = 0; i < 60; i++) inner = { type: 'link', href: 'https://a.example', content: [inner] }
      expect(sanitizeRichText([{ type: 'paragraph', content: [inner] }])).toBeNull()
    })
    it('rejects a ~100k-level structure without crashing', () => {
      let b: Record<string, unknown> = { type: 'paragraph', children: [] }
      for (let i = 0; i < 100_000; i++) b = { type: 'paragraph', children: [b] }
      expect(sanitizeRichText([b])).toBeNull()
      let arr: unknown[] = []
      for (let i = 0; i < 100_000; i++) arr = [arr]
      expect(sanitizeRichText([{ type: 'paragraph', content: arr }])).toBeNull()
    })
    it('rejects cyclic input', () => {
      const block: Record<string, unknown> = { type: 'paragraph' }
      block.children = [block]
      expect(sanitizeRichText([block])).toBeNull()
    })
    it('rejects values JSON cannot represent (BigInt)', () => {
      expect(sanitizeRichText([{ type: 'paragraph', props: { n: BigInt(1) } }])).toBeNull()
    })
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
