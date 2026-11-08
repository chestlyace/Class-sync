import { describe, expect, it } from 'vitest'
import { parseItemForm } from './notes-form'

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const BODY = JSON.stringify([{ type: 'paragraph', content: 'Hello' }])

describe('parseItemForm', () => {
  it('rejects a link that is not http(s)', () => {
    expect(parseItemForm('link', form({ title: 'Docs', url: 'javascript:x' }))).toEqual({ ok: false, fields: ['url'] })
  })

  it('reads a link and normalises its URL', () => {
    const out = parseItemForm('link', form({ title: ' Docs ', url: 'https://example.com' }))
    expect(out).toEqual({ ok: true, value: { kind: 'link', title: 'Docs', url: 'https://example.com/' } })
  })

  it('requires a title on a note', () => {
    expect(parseItemForm('note', form({ title: '  ', body: BODY }))).toEqual({ ok: false, fields: ['title'] })
  })

  it('reports every bad field of a note together', () => {
    expect(parseItemForm('note', form({ title: '', body: 'not json' }))).toEqual({
      ok: false,
      fields: ['title', 'body'],
    })
  })

  it('reads a note with its rich-text body', () => {
    const out = parseItemForm('note', form({ title: 'Week 1', body: BODY }))
    expect(out).toEqual({ ok: true, value: { kind: 'note', title: 'Week 1', body: JSON.parse(BODY) } })
  })

  it('requires a file on a file item', () => {
    expect(parseItemForm('file', form({ title: 'Slides' }))).toEqual({ ok: false, fields: ['file'] })
  })

  it('reads a file item', () => {
    expect(parseItemForm('file', form({ title: 'Slides', fileId: 'f1' }))).toEqual({
      ok: true,
      value: { kind: 'file', title: 'Slides', fileId: 'f1' },
    })
  })
})
