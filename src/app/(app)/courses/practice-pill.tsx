import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** A text pill in mono capitals (WAITING, RIGHT ANSWER, …): states are words, never dots. */
export function PracticePill({
  children,
  variant = 'outline',
  className,
}: {
  children: React.ReactNode
  variant?: 'outline' | 'secondary' | 'default' | 'destructive'
  className?: string
}) {
  return (
    <Badge variant={variant} className={cn('h-6 px-2.5 font-mono tracking-[0.08em] uppercase', className)}>
      {children}
    </Badge>
  )
}
