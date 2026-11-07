'use client'

import { ArrowRight, ClipboardCheck } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { STUDENT_POLL_MS } from '@/server/attendance/rules'
import { listOpenCheckInsAction } from '../check-in/actions'
import type { OpenCheckInView } from '../check-in/view'

/**
 * "Check-in open" banner on the student dashboard. Polls while the tab is visible (and once
 * when it comes back) and stays hidden while every open check-in is done or none is open.
 */
export function OpenCheckIns({ initial }: { initial: OpenCheckInView[] }) {
  const t = useTranslations('attendance.student')
  const locale = useLocale()
  const [open, setOpen] = useState(initial)
  const latest = useRef(0)

  useEffect(() => {
    let active = true
    async function poll() {
      if (document.visibilityState !== 'visible') return
      const request = ++latest.current
      try {
        const result = await listOpenCheckInsAction()
        // Only the newest request may write; a failed poll keeps what is on screen.
        if (active && request === latest.current && result.ok) setOpen(result.data)
      } catch {
        // Offline or a deploy in progress: try again on the next tick.
      }
    }
    const timer = setInterval(poll, STUDENT_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [])

  const pending = [...new Set(open.filter((c) => !c.checkedIn).map((c) => c.courseTitle))]
  const courses = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(pending)

  // `contents`: no box of its own, so an empty region adds no gap to the page's flex column.
  return (
    <div aria-live="polite" className="contents">
      {pending.length > 0 && (
        <div className="flex flex-col gap-4 rounded-3xl border border-primary/30 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <ClipboardCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="font-semibold">{t('bannerTitle', { courses })}</p>
          </div>
          <Link href="/check-in" className={buttonVariants()}>
            {t('submit')}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </div>
      )}
    </div>
  )
}
