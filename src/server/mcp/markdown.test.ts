import { describe, expect, it } from 'vitest'
import { sanitizeRichText } from '@/server/assignments/rich-text'
import { markdownToBlocks, parseInline } from './markdown'

const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles })

describe('markdownToBlocks', () => {
  it('turns plain text into paragraphs (blank lines split, lines join)', () => {
    const blocks = markdownToBlocks('First line\nsame paragraph.\n\nSecond.')
    expect(blocks).toEqual([
      { type: 'paragraph', props: {}, content: [text('First line same paragraph.')], children: [] },
      { type: 'paragraph', props: {}, content: [text('Second.')], children: [] },
    ])
  })

  it('reads headings, lists, check items, quotes and code', () => {
    const blocks = markdownToBlocks(
      '# Title\n### Small\n#### Smaller\n- one\n  - nested\n- two\n1. first\n- [x] done\n> quoted\n```js\nconst a = 1\n```',
    )
    expect(blocks.map((b) => [b.type, b.props])).toEqual([
      ['heading', { level: 1 }],
      ['heading', { level: 3 }],
      ['heading', { level: 3 }],
      ['bulletListItem', {}],
      ['bulletListItem', {}],
      ['numberedListItem', {}],
      ['checkListItem', { checked: true }],
      ['quote', {}],
      ['codeBlock', { language: 'js' }],
    ])
    expect(blocks[3].children!.map((c) => c.content)).toEqual([[text('nested')]])
    expect(blocks[8].content).toBe('const a = 1')
  })

  it('reads inline styles and safe links; unsafe links stay text', () => {
    expect(parseInline('a **b** *c* `d` ~~e~~ [f](https://x.org)')).toEqual([
      text('a '),
      text('b', { bold: true }),
      text(' '),
      text('c', { italic: true }),
      text(' '),
      text('d', { code: true }),
      text(' '),
      text('e', { strike: true }),
      text(' '),
      { type: 'link', href: 'https://x.org', content: [text('f')] },
    ])
    expect(parseInline('[x](javascript:alert(1))')).toEqual([text('[x](javascript:alert(1))')])
    expect(parseInline('2 * 3 = 6 and **open')).toEqual([text('2 * 3 = 6 and **open')])
  })

  it('always gives a document the services accept', () => {
    for (const source of ['', '   ', '# only', '- a\n\n\n- b', 'x'.repeat(10_000)]) {
      expect(sanitizeRichText(markdownToBlocks(source))).not.toBeNull()
    }
  })
})
