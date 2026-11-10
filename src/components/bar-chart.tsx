import { cn } from '@/lib/utils'
import type { DailyPoint } from '@/server/admin/queries'

export type ChartSeries = { label: string; points: DailyPoint[] }

const HEIGHT = 100
const SLOT = 10 // viewBox units per day
const GAP = 2 // between days
// At most two series: the app's foreground, then a muted grey.
const BAR_TONES = ['fill-foreground', 'fill-muted-foreground/45'] as const
const SWATCH_TONES = ['bg-foreground', 'bg-muted-foreground/45'] as const

/** "12 Oct" / "12 oct." for a YYYY-MM-DD calendar day. */
function dayFormatter(locale: string): (day: string) => string {
  const format = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return (day) => {
    const [y, m, d] = day.split('-').map(Number)
    return format.format(new Date(Date.UTC(y, m - 1, d)))
  }
}

/**
 * A small daily bar chart in inline SVG (one bar per day, side by side for two series). Screen
 * readers get the title and a visually hidden table of every value.
 */
export function BarChart({
  title,
  series,
  dayLabel = 'Day',
  locale = 'en',
  className,
}: {
  title: string
  series: ChartSeries[]
  /** Header of the hidden table's date column. */
  dayLabel?: string
  locale?: string
  className?: string
}) {
  const shown = series.slice(0, 2)
  const days = shown[0]?.points.map((p) => p.day) ?? []
  const max = Math.max(1, ...shown.flatMap((s) => s.points.map((p) => p.value)))
  const barWidth = (SLOT - GAP) / Math.max(1, shown.length)
  const formatDay = dayFormatter(locale)

  return (
    <figure className={cn('flex min-w-0 flex-col gap-2', className)}>
      {shown.length > 1 && (
        <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {shown.map((s, i) => (
            <li key={s.label} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2.5 rounded-[3px]', SWATCH_TONES[i])} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${days.length * SLOT} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-28 w-full border-b border-input"
      >
        <title>{title}</title>
        {shown.map((s, si) => (
          <g key={s.label} data-series={si} className={BAR_TONES[si]}>
            {s.points.map((p, i) => {
              const h = p.value > 0 ? Math.max(1.5, (p.value / max) * HEIGHT) : 0
              return (
                <rect key={p.day} x={i * SLOT + GAP / 2 + si * barWidth} y={HEIGHT - h} width={barWidth} height={h} />
              )
            })}
          </g>
        ))}
      </svg>
      {days.length > 0 && (
        <div aria-hidden="true" className="flex justify-between font-mono text-[11px] text-muted-foreground">
          <span>{formatDay(days[0])}</span>
          <span>{formatDay(days[days.length - 1])}</span>
        </div>
      )}
      {/* The wrapper is what's hidden: a table ignores width: 1px and would widen the page. */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{dayLabel}</th>
              {shown.map((s) => (
                <th key={s.label} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => (
              <tr key={day}>
                <th scope="row">{formatDay(day)}</th>
                {shown.map((s) => (
                  <td key={s.label}>{s.points[i]?.value ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
