import { describe, expect, it } from 'vitest'
import { separatorAligns, splitTableRow, upgradeTextTables } from './markdown-table'

const text = (t: string, styles = {}) => ({ type: 'text', text: t, styles })
const para = (content: unknown, children: unknown[] = []) => ({ type: 'paragraph', props: {}, content, children })
const cell = (content: unknown, props = {}) => ({ type: 'tableCell', props, content })
const table = (rows: unknown[][]) => ({
  type: 'table',
  props: {},
  content: { type: 'tableContent', headerRows: 1, rows: rows.map((cells) => ({ cells })) },
  children: [],
})

describe('splitTableRow', () => {
  it('splits on unescaped pipes and drops the outer ones', () => {
    expect(splitTableRow('| a | b \\| c |')).toEqual(['a', 'b | c'])
    expect(splitTableRow('a | b')).toEqual(['a', 'b'])
    expect(splitTableRow('|  | x |')).toEqual(['', 'x'])
  })
})

describe('separatorAligns', () => {
  it('reads alignments and refuses anything else', () => {
    expect(separatorAligns('| :--- | :-: | --: | --- |')).toEqual(['left', 'center', 'right', 'left'])
    expect(separatorAligns('---')).toBeNull()
    expect(separatorAligns('| a | --- |')).toBeNull()
    expect(separatorAligns('| : |')).toBeNull()
  })
})

describe('upgradeTextTables', () => {
  it('turns one paragraph per row into a table, keeping styles and padding short rows', () => {
    const doc = [
      para([text('Before')]),
      para('| Name | Mark |'),
      para('| --- | ---: |'),
      para([text('| '), text('Ada', { bold: true }), text(' | 18 |')]),
      para('| Bo |'),
      para([text('After')]),
    ]
    expect(upgradeTextTables(doc)).toEqual([
      para([text('Before')]),
      table([
        [cell([text('Name')]), cell([text('Mark')], { textAlignment: 'right' })],
        [cell([text('Ada', { bold: true })]), cell([text('18')], { textAlignment: 'right' })],
        [cell([text('Bo')]), cell([], { textAlignment: 'right' })],
      ]),
      para([text('After')]),
    ])
  })

  it('splits a table joined into one paragraph, as earlier drafts stored it', () => {
    const doc = [para([text('|  | Mon | Tue | | --- | :-: | --- | | 8am | Maths |  |')])]
    expect(upgradeTextTables(doc)).toEqual([
      table([
        [cell([]), cell([text('Mon')], { textAlignment: 'center' }), cell([text('Tue')])],
        [cell([text('8am')]), cell([text('Maths')], { textAlignment: 'center' }), cell([])],
      ]),
    ])
  })

  it('looks inside nested blocks', () => {
    const doc = [{ type: 'bulletListItem', props: {}, content: [], children: [para('| a | b |'), para('|---|---|')] }]
    const [item] = upgradeTextTables(doc) as Array<{ children: Array<{ type: string }> }>
    expect(item.children.map((b) => b.type)).toEqual(['table'])
  })

  it('returns the same array when there is no table', () => {
    const doc = [para('a | b'), para('just text'), para('| a | b | | c |'), para('Title'), para('---')]
    expect(upgradeTextTables(doc)).toBe(doc)
  })
})
