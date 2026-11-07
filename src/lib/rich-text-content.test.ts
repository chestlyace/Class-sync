import { describe, expect, it } from 'vitest'
import { filterRichText, richTextPlainText } from './rich-text-content'

const names = {
  blocks: new Set(['paragraph', 'heading', 'table']),
  inline: new Set(['text', 'link']),
  styles: new Set(['bold', 'italic', 'textColor']),
}

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text: t, styles })

describe('filterRichText', () => {
  it('drops unknown inline types and keeps the known ones', () => {
    const doc = [
      {
        type: 'paragraph',
        props: {},
        content: [text('Hello '), { type: 'mention', user: 'x' }, { type: 'link', href: 'https://a.b', content: [text('link')] }],
        children: [],
      },
    ]
    expect(filterRichText(doc, names)).toEqual([
      {
        type: 'paragraph',
        props: {},
        content: [text('Hello '), { type: 'link', href: 'https://a.b', content: [text('link')] }],
        children: [],
      },
    ])
  })

  it('drops unknown style keys and non-scalar style values', () => {
    const doc = [{ type: 'paragraph', content: [text('x', { bold: true, glow: true, textColor: 'red', italic: {} })] }]
    expect(filterRichText(doc, names)).toEqual([{ type: 'paragraph', content: [text('x', { bold: true, textColor: 'red' })] }])
  })

  it('drops unknown blocks, at any depth, and text items without text', () => {
    const doc = [
      { type: 'image', props: { url: 'https://x' } },
      { type: 'heading', content: [{ type: 'text' }], children: [{ type: 'video' }, { type: 'paragraph', content: 'plain' }] },
    ]
    expect(filterRichText(doc, names)).toEqual([
      { type: 'heading', content: [], children: [{ type: 'paragraph', content: 'plain' }] },
    ])
  })

  it('filters inline content inside table cells', () => {
    const doc = [
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [[text('a'), { type: 'weird' }], { type: 'tableCell', props: {}, content: [{ type: 'weird' }, text('b')] }] }],
        },
      },
    ]
    expect(filterRichText(doc, names)).toEqual([
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [[text('a')], { type: 'tableCell', props: {}, content: [text('b')] }] }],
        },
      },
    ])
  })

  it('returns undefined for an empty, invalid or fully unknown document', () => {
    expect(filterRichText([], names)).toBeUndefined()
    expect(filterRichText('nope', names)).toBeUndefined()
    expect(filterRichText([{ type: 'audio' }, null, 3], names)).toBeUndefined()
  })
})

describe('richTextPlainText', () => {
  it('extracts the text of every block, including unknown inline items with text and nested children', () => {
    const doc = [
      { type: 'heading', content: [text('Title')] },
      {
        type: 'paragraph',
        content: [text('Hello '), { type: 'mention', text: 'Bea' }, { type: 'link', content: [text(' there')] }],
        children: [{ type: 'paragraph', content: 'child' }],
      },
      { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[text('a')], { type: 'tableCell', content: [text('b')] }] }] } },
      { type: 'paragraph', content: [] },
    ]
    expect(richTextPlainText(doc)).toBe('Title\nHello Bea there\nchild\na\tb')
  })

  it('returns an empty string for anything that is not a document', () => {
    expect(richTextPlainText(null)).toBe('')
    expect(richTextPlainText({ type: 'paragraph' })).toBe('')
  })
})
