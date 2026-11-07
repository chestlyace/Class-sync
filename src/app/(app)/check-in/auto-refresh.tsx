'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Re-renders the page from the server every `intervalMs` while the tab is visible, and right
 * away when it becomes visible again, so check-ins opened or closed in class show up.
 */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const timer = setInterval(refresh, intervalMs)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, intervalMs])
  return null
}
