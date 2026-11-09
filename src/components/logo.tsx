import { cn } from '@/lib/utils'
import { LOGO_VIEWBOX, MARK_PATHS, MARK_VIEWBOX, WORDMARK_PATHS } from './logo-paths'

type LogoProps = { className?: string; title?: string }

/**
 * The Clasync logo, drawn in `currentColor`: dark on the light theme, white on dark surfaces, with
 * no separate files. Size it by height (`h-6 w-auto`). The same-colour hairline stroke closes the
 * seam where the mark's two halves meet.
 */
export function Logo({ className, title = 'Clasync' }: LogoProps) {
  return (
    <svg viewBox={LOGO_VIEWBOX} role="img" aria-label={title} className={cn('h-6 w-auto shrink-0', className)}>
      <g fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        {[...MARK_PATHS, ...WORDMARK_PATHS].map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  )
}

/** The mark alone (the hexagonal C), for tight spaces. */
export function LogoMark({ className, title = 'Clasync' }: LogoProps) {
  return (
    <svg viewBox={MARK_VIEWBOX} role="img" aria-label={title} className={cn('size-6 shrink-0', className)}>
      <g fill="currentColor" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        {MARK_PATHS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  )
}
