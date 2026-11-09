import { describe, expect, it } from 'vitest'
import { sanitizeRichText } from '@/server/assignments/rich-text'
import { MARKDOWN_MAX, markdownToBlocks, parseInline } from './markdown'

const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles })

describe('markdownToBlocks', () => {
  it('turns plain text into paragraphs (blank lines split, lines join)', () => {
    const blocks = markdownToBlocks('First line\nsame paragraph.\n\nSecond.')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        props: {},
        content: [text('First line same paragraph.')],
        children: [],
      },
      {
        type: 'paragraph',
        props: {},
        content: [text('Second.')],
        children: [],
      },
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

  it("keeps a heading's own # and drops closing ones", () => {
    expect(markdownToBlocks('## Title ##').map((b) => b.content)).toEqual([[text('Title')]])
    expect(markdownToBlocks('# C#').map((b) => b.content)).toEqual([[text('C#')]])
    expect(markdownToBlocks('# a   #  ').map((b) => b.content)).toEqual([[text('a')]])
  })

  it('caps list nesting so the document stays within the sanitiser depth', () => {
    const deep = Array.from({ length: 60 }, (_, i) => `${' '.repeat(i * 2)}- level ${i}`).join('\n')
    expect(sanitizeRichText(markdownToBlocks(deep))).not.toBeNull()
  })

  describe('stays linear on pathological input (100k characters per line, under 50 ms of CPU each)', () => {
    const N = 100_000
    const cases: [string, string][] = [
      ['heading with long trailing spaces', '# a' + ' '.repeat(N) + 'x'],
      ['heading of hashes and spaces', '# ' + '# '.repeat(N / 2) + 'x'],
      ['open brackets', '['.repeat(N)],
      ['brackets then a close', '['.repeat(N) + ']('],
      ['brackets before a long unclosed url', '['.repeat(N / 2) + 'a](' + 'h'.repeat(N / 2)],
      ['bracket pairs without urls', '[a]'.repeat(N / 3)],
      ['stars', '*'.repeat(N)],
      ['star words', '*a '.repeat(N / 3)],
      ['double stars', '**a '.repeat(N / 4)],
      ['underscores', '_'.repeat(N)],
      ['tildes', '~'.repeat(N)],
      ['backticks', '`'.repeat(N)],
      ['backtick words', '`a '.repeat(N / 3)],
      ['escapes', '\\'.repeat(N)],
      ['list marker then spaces', '-' + ' '.repeat(N) + '\u2028x'],
      ['digits', '1'.repeat(N) + 'x'],
      ['spaces then a non-marker', ' '.repeat(N) + 'x'],
      ['fence with spaces', '```' + ' '.repeat(N) + 'x!'],
      ['quote with spaces', '>' + ' '.repeat(N)],
      ['check item', '- [x]' + ' '.repeat(N) + '\u2029'],
      ['nested styles', '**_~~`'.repeat(N / 6)],
      // Many short lines: the per-line work is fixed, so 20k characters show the same thing.
      ['many lines', 'a\n'.repeat(N / 10)],
      ['many list items', '- a\n  '.repeat(N / 30)],
    ]
    for (const [name, source] of cases) {
      it(name, () => {
        markdownToBlocks(source.slice(0, 10_000)) // warm the JIT up
        // Best of five, in this process's CPU time, so neither a garbage collection pause nor other
        // work on the machine counts; a backtracking regex took seconds on these inputs.
        let best = Infinity
        for (let run = 0; run < 5; run++) {
          const started = process.cpuUsage()
          markdownToBlocks(source)
          const used = process.cpuUsage(started)
          best = Math.min(best, (used.user + used.system) / 1000)
        }
        expect(best).toBeLessThan(50)
      })
    }
  })

  it('reads at most MARKDOWN_MAX characters', () => {
    const blocks = markdownToBlocks('a'.repeat(MARKDOWN_MAX + 10))
    expect((blocks[0].content as { text: string }[])[0].text).toHaveLength(MARKDOWN_MAX)
  })

  it('reads marker runs as before: only their last characters can open a style', () => {
    expect(parseInline('*****a*')).toEqual([text('****'), text('a', { italic: true })])
    expect(parseInline('****a**')).toEqual([text('*'), text('*a', { bold: true })])
    expect(parseInline('~~~~x~~')).toEqual([text('~'), text('~x', { strike: true })])
    expect(parseInline('```a`')).toEqual([text('``'), text('a', { code: true })])
    expect(parseInline('______')).toEqual([text('______')])
  })
})
