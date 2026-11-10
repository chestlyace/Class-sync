import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BarChart } from './bar-chart'

/** 30 days ending 2026-11-10, with `value(i)` on day i. */
function points(value: (i: number) => number) {
  return Array.from({ length: 30 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10),
    value: value(i),
  }))
}

const count = (html: string, re: RegExp) => html.match(re)?.length ?? 0

describe('BarChart', () => {
  it('draws 30 bars for a series, with an accessible title', () => {
    const html = renderToStaticMarkup(<BarChart title="Sign-ups" series={[{ label: 'Lecturers', points: points((i) => i) }]} />)
    expect(count(html, /<rect /g)).toBe(30)
    expect(count(html, /data-series="0"/g)).toBe(1)
    expect(html).toMatch(/<svg[^>]*role="img"/)
    expect(html).toContain('<title>Sign-ups</title>')
  })

  it('draws one group of 30 bars per series', () => {
    const html = renderToStaticMarkup(
      <BarChart
        title="Sign-ups"
        series={[
          { label: 'Lecturers', points: points(() => 1) },
          { label: 'Students', points: points(() => 4) },
        ]}
      />,
    )
    expect(count(html, /<g [^>]*data-series=/g)).toBe(2)
    expect(count(html, /<rect /g)).toBe(60)
  })

  it('lists every value in a visually hidden table', () => {
    const html = renderToStaticMarkup(
      <BarChart
        title="Sign-ups"
        series={[
          { label: 'Lecturers', points: points((i) => i * 3) },
          { label: 'Students', points: points((i) => 1000 + i) },
        ]}
      />,
    )
    const table = /<div class="sr-only"><table>([\s\S]*)<\/table><\/div>/.exec(html)?.[1]
    expect(table).toBeDefined()
    expect(table).toContain('<caption>Sign-ups</caption>')
    expect(table).toContain('<th scope="col">Lecturers</th>')
    expect(table).toContain('<th scope="col">Students</th>')
    expect(count(table!, /<tr>/g)).toBe(31) // header + 30 days
    expect(table).toContain('<td>87</td>') // lecturers, last day
    expect(table).toContain('<td>1029</td>') // students, last day
  })

  it('draws nothing taller than the chart when every day is zero', () => {
    const html = renderToStaticMarkup(<BarChart title="Empty" series={[{ label: 'None', points: points(() => 0) }]} />)
    expect(count(html, /<rect /g)).toBe(30)
    expect(html).not.toMatch(/height="(?:NaN|Infinity|-)/)
  })
})
