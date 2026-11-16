import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PageSkeleton } from './page-skeletons'

const VARIANTS = ['panels', 'cards', 'list', 'table'] as const

/** The status element's opening tag, so an unrelated `role="status"` substring elsewhere can't satisfy a test. */
const STATUS = /<div\b[^>]*\brole="status"[^>]*>/

function render(variant: (typeof VARIANTS)[number]) {
  return renderToStaticMarkup(<PageSkeleton label="Loading…" variant={variant} />)
}

describe('PageSkeleton', () => {
  it.each(VARIANTS)('announces loading to screen readers (%s)', (variant) => {
    const html = render(variant)
    expect(html).toMatch(STATUS)
    expect(html).toMatch(/<span class="sr-only">Loading…<\/span>/)
  })

  it.each(VARIANTS)('fades in after a delay on the status element (%s)', (variant) => {
    const status = render(variant).match(STATUS)?.[0]
    expect(status).toContain('animate-skeleton-in')
    expect(status).toContain('motion-reduce:animate-none')
  })

  it('uses the same column rhythm as the signed-in main', () => {
    const classes = render('panels').match(STATUS)?.[0].match(/class="([^"]*)"/)?.[1].split(' ')
    expect(classes).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-10']))
  })

  it('draws the table body', () => {
    const rows = render('table').match(/\bdata-skeleton-row=""/g) ?? []
    expect(rows.length).toBe(9) // header + 8 body rows
  })

  it('draws the other shapes', () => {
    expect(render('list').match(/\bdata-skeleton-row=""/g)?.length).toBe(6)
    expect(render('cards').match(/\bdata-skeleton-card=""/g)?.length).toBe(6)
    expect(render('panels').match(/\bdata-skeleton-panel=""/g)?.length).toBe(2)
  })

  it('hides the shapes from assistive tech and turns pulsing off for reduced motion', () => {
    const html = render('list')
    const pulsing = html.match(/<div\b[^>]*animate-pulse[^>]*>/g) ?? []
    expect(pulsing.length).toBeGreaterThan(0)
    for (const el of pulsing) {
      expect(el).toContain('aria-hidden="true"')
      expect(el).toContain('motion-reduce:animate-none')
    }
  })
})
