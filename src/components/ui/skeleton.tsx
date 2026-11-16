import { cn } from '@/lib/utils'

/** A quiet grey placeholder block. Decorative: the loading state is announced by the page skeleton, not by each block. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-xl bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  )
}
