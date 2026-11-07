import { cn } from '@/lib/utils'

/** Mono eyebrow, Bebas Neue title (page titles are the only Bebas text besides big numbers). */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-5', className)}>
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em] break-words sm:text-6xl">{title}</h1>
        {description && <p className="max-w-prose text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  )
}

/** Small uppercase mono label. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase', className)}>
      {children}
    </span>
  )
}

/** Section heading: mono label with a hairline running to the edge. */
export function SectionHeading({
  children,
  as: Tag = 'h2',
  id,
}: {
  children: React.ReactNode
  as?: 'h2' | 'h3'
  id?: string
}) {
  return (
    <div className="flex items-center gap-4">
      <Tag id={id} className="min-w-0 font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">
        {children}
      </Tag>
      <span aria-hidden="true" className="h-px flex-1 bg-input" />
    </div>
  )
}

/** White panel with a hairline border. */
export function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-3xl border bg-card p-5 sm:p-7', className)} {...props} />
}
