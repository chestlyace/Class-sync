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
    // Reduced motion keeps the delay (no grey flash on fast pages) but drops the fade.
    expect(status).toContain('motion-reduce:[animation-duration:0s]')
    expect(status).not.toContain('motion-reduce:animate-none')
  })

  it.each(VARIANTS)('header bars fill the real PageHeader line boxes (%s)', (variant) => {
    const html = render(variant)
    // eyebrow text-xs 16px, title text-5xl/text-6xl at leading 0.95 (45.6px / 57px), description text-base 24px
    expect(html).toContain('h-4 w-24')
    expect(html).toContain('h-[45.6px] w-2/3 sm:h-[57px]')
    expect(html).toContain('h-6 w-1/2')
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
