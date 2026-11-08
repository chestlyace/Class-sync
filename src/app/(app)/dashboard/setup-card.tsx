'use client'

import { X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { dismissSetupAction } from './actions'

const EXIT_MS = 160

/**
 * The setup checklist's frame: fades away at once when dismissed (the cookie is set in the
 * background), then the refreshed dashboard renders without it.
 */
export function SetupCard({
  titleId,
  dismissLabel,
  children,
}: {
  titleId: string
  dismissLabel: string
  children: React.ReactNode
}) {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setGone(true), EXIT_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  function dismiss() {
    setLeaving(true)
    startTransition(async () => {
      await dismissSetupAction()
    })
  }

  if (gone) return null
  return (
    <section
      aria-labelledby={titleId}
      data-testid="setup-checklist"
      data-leaving={leaving || undefined}
      className="relative rounded-3xl border bg-card px-5 pt-5 pb-2 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-leaving:-translate-y-1 data-leaving:opacity-0 motion-reduce:data-leaving:translate-y-0 sm:px-7 sm:pt-6"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label={dismissLabel}
        title={dismissLabel}
        className="absolute top-3 right-3 text-muted-foreground sm:top-4 sm:right-4"
      >
        <X aria-hidden="true" />
      </Button>
      {children}
    </section>
  )
}
