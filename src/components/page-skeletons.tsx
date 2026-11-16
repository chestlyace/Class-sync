import { Panel } from '@/components/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type PageSkeletonVariant = 'panels' | 'cards' | 'list' | 'table'

/**
 * Same shape as `PageHeader` (eyebrow, title, one line), so nothing jumps when the real header arrives.
 * Each bar fills the real line box: text-xs 16px, text-5xl/text-6xl at leading 0.95 (45.6px / 57px), text-base 24px.
 */
function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-[45.6px] w-2/3 sm:h-[57px]" />
      <Skeleton className="h-6 w-1/2" />
    </div>
  )
}

/** Same shape as `SectionHeading`: a label and the hairline running to the edge. */
function SectionHeadingSkeleton() {
  return (
    <div className="flex items-center gap-4">
      {/* The real label is 13px mono at the inherited 1.5 line height (19.5px); keep that box, draw a thinner bar in it. */}
      <div className="flex h-[19.5px] items-center">
        <Skeleton className="h-3.5 w-32" />
      </div>
      <span aria-hidden="true" className="h-px flex-1 bg-input" />
    </div>
  )
}

function PanelsBody() {
  return (
    <>
      {[0, 1].map((panel) => (
        <Panel key={panel} data-skeleton-panel="" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </Panel>
      ))}
    </>
  )
}

function CardsBody() {
  return (
    <>
      <SectionHeadingSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, card) => (
          <Skeleton key={card} data-skeleton-card="" className="h-36 rounded-3xl" />
        ))}
      </div>
    </>
  )
}

function ListBody() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 6 }, (_, row) => (
        <Skeleton key={row} data-skeleton-row="" className="h-16 rounded-2xl" />
      ))}
    </div>
  )
}

function TableBody() {
  return (
    <Panel className="flex flex-col gap-4 sm:p-5">
      {Array.from({ length: 9 }, (_, row) => (
        <div key={row} data-skeleton-row="" className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, cell) => (
            <Skeleton key={cell} className={cn('h-4', row === 0 && 'h-3 w-2/3')} />
          ))}
        </div>
      ))}
    </Panel>
  )
}

const BODIES: Record<PageSkeletonVariant, () => React.JSX.Element> = {
  panels: PanelsBody,
  cards: CardsBody,
  list: ListBody,
  table: TableBody,
}

/**
 * What a signed-in page shows while its data loads. It fades in after a short delay, so a fast page never flashes it.
 * Reduced motion keeps the delay but drops the fade (zero duration, fill both), so a fast page still never flashes grey.
 * The label is passed in (the `loading.tsx` files hold the translation), which keeps this a plain server-safe component.
 */
export function PageSkeleton({ label, variant }: { label: string; variant: PageSkeletonVariant }) {
  const Body = BODIES[variant]
  return (
    <div role="status" className="flex animate-skeleton-in flex-col gap-10 motion-reduce:[animation-duration:0s]">
      <span className="sr-only">{label}</span>
      <HeaderSkeleton />
      <Body />
    </div>
  )
}
