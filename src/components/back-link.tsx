'use client'

import { ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useSyncExternalStore } from 'react'
import {
  CURRENT_PAGE_KEY,
  PAGE_HISTORY_EVENT,
  PREVIOUS_PAGE_KEY,
  visitPage,
} from '@/lib/navigation-history'

function subscribe(onChange: () => void): () => void {
  window.addEventListener(PAGE_HISTORY_EVENT, onChange)
  return () => window.removeEventListener(PAGE_HISTORY_EVENT, onChange)
}

function previousPage(): string | null {
  return sessionStorage.getItem(PREVIOUS_PAGE_KEY)
}

/**
 * A breadcrumb-style Back control for the signed-in area. It remembers real in-app navigations in
 * sessionStorage, so it never sends someone back to a page outside the app or to a bare history
 * entry. Refreshing or changing only the query keeps the previous page.
 */
export function BackLink({ fallback = '/dashboard' }: { fallback?: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const previous = useSyncExternalStore(subscribe, previousPage, () => null)

  useEffect(() => {
    const url = `${pathname}${window.location.search}`
    const next = visitPage(
      {
        current: sessionStorage.getItem(CURRENT_PAGE_KEY),
        previous: sessionStorage.getItem(PREVIOUS_PAGE_KEY),
      },
      url,
    )
    sessionStorage.setItem(CURRENT_PAGE_KEY, next.current)
    if (next.previous) sessionStorage.setItem(PREVIOUS_PAGE_KEY, next.previous)
    else sessionStorage.removeItem(PREVIOUS_PAGE_KEY)
    window.dispatchEvent(new Event(PAGE_HISTORY_EVENT))
  }, [pathname])

  return (
    <Link
      href={previous ?? fallback}
      aria-label={t('back')}
      title={t('back')}
      className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-2.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      <span className="hidden text-xs font-medium lg:inline">{t('back')}</span>
    </Link>
  )
}
