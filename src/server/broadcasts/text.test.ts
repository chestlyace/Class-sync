import { render } from '@react-email/render'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { BroadcastEmail } from '@/server/email/templates/broadcast'
import { bodyToParagraphs } from './text'

const page = 'https://clasync.test/unsubscribe/abc'

const broadcast = (locale: 'en' | 'fr', body: string) =>
  createElement(BroadcastEmail, { locale, body, unsubscribePageUrl: page })

describe('bodyToParagraphs', () => {
  it('splits paragraphs on blank lines and keeps line breaks', () => {
    expect(bodyToParagraphs('First line\nsecond line\n\n\nNext paragraph\r\n\r\nLast')).toEqual([
      [[{ kind: 'text', value: 'First line' }], [{ kind: 'text', value: 'second line' }]],
      [[{ kind: 'text', value: 'Next paragraph' }]],
      [[{ kind: 'text', value: 'Last' }]],
    ])
  })

  it('treats lines of only spaces as blank lines, with no stray empty line', () => {
    expect(bodyToParagraphs(' \t\nFirst\n  \n\t\n \nSecond\n  indented\n   \n')).toEqual([
      [[{ kind: 'text', value: 'First' }]],
      [[{ kind: 'text', value: 'Second' }], [{ kind: 'text', value: '  indented' }]],
    ])
  })

  it('turns https links into links and leaves trailing punctuation outside', () => {
    expect(bodyToParagraphs('See https://clasync.online/news, then (http://example.org/a?b=1).')).toEqual([
      [
        [
          { kind: 'text', value: 'See ' },
          { kind: 'link', href: 'https://clasync.online/news' },
          { kind: 'text', value: ', then (' },
          { kind: 'link', href: 'http://example.org/a?b=1' },
          { kind: 'text', value: ').' },
        ],
      ],
    ])
  })

  it('does not link javascript: or mailto:', () => {
    const lines = bodyToParagraphs('javascript:alert(1) mailto:ada@example.com data:text/html,hi').flat()
    expect(lines.flat().every((piece) => piece.kind === 'text')).toBe(true)
  })
})

describe('BroadcastEmail', () => {
  it('keeps <script> and & as plain text', async () => {
    const html = await render(broadcast('en', '<script>alert(1)</script> Tom & Jerry'))
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Tom &amp; Jerry')
    expect(html).not.toContain('<script')
  })

  it('does not link javascript: or mailto: in the page', async () => {
    const html = await render(broadcast('en', 'javascript:alert(1) mailto:ada@example.com'))
    expect(html).not.toMatch(/href="javascript:/i)
    expect(html).not.toMatch(/href="mailto:/i)
  })

  it('links https addresses and the stop link, in the reader language', async () => {
    const body = 'Read https://clasync.online/whats-new.'
    const en = await render(broadcast('en', body))
    expect(en).toContain('href="https://clasync.online/whats-new"')
    expect(en).toContain(`href="${page}"`)
    expect(en).toContain('Stop these announcements')
    const fr = await render(broadcast('fr', body))
    expect(fr).toContain('Ne plus recevoir ces annonces')
    const text = await render(broadcast('en', body), { plainText: true })
    expect(text).toContain(page)
    expect(text).toContain('Read')
  })
})
