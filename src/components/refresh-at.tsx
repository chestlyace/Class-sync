'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { refreshDelayMs } from '@/lib/refresh-delay'

/**
 * Refreshes the page (server data) just after `at`, e.g. when marking and release open once late
 * answers can no longer arrive. `serverNow` is when the page was rendered, on the server's clock.
 */
export function RefreshAt({ at, serverNow }: { at: string; serverNow: string }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setTimeout(() => router.refresh(), refreshDelayMs(at, serverNow))
    return () => clearTimeout(timer)
  }, [at, serverNow, router])
  return null
}
