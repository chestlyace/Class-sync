'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

const REFRESH_MS = 5000

/**
 * Re-fetches the page every few seconds while `active` (a broadcast is still sending), and
 * stops once it is not. A hidden tab skips the refresh. Renders nothing.
 */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, router])
  return null
}
