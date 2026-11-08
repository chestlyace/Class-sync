import { getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils'

/**
 * While the dashboard loads: its shape in quiet grey (a header, the class row, three course
 * cards), so nothing jumps when the real page arrives.
 */
export default async function DashboardLoading() {
  const t = await getTranslations('common')
  const bar = 'block rounded-full bg-muted motion-safe:animate-pulse'
  return (
    <div role="status" className="flex flex-col gap-10">
      <span className="sr-only">{t('loading')}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <span className={cn(bar, 'h-3 w-36')} />
        <span className={cn(bar, 'h-11 w-64 max-w-full rounded-xl sm:h-14 sm:w-80')} />
      </div>
      <div aria-hidden="true" className="flex flex-col gap-3.5">
        <span className={cn(bar, 'h-4 w-48')} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-36 flex-col gap-2.5 rounded-2xl border px-5 py-4">
              <span className={cn(bar, 'h-3 w-20')} />
              <span className={cn(bar, 'h-5 w-40')} />
              <span className={cn(bar, 'mt-auto h-7 w-16 rounded-lg')} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
