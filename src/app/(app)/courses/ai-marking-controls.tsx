'use client'

import { RotateCcw, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ActionError } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import { suggestMarksAction, suggestOneAction } from './assignment-actions'

/** How often a page with AI suggestions in progress asks the server again, and for how long. */
const REFRESH_EVERY_MS = 10_000
const REFRESH_FOR_MS = 10 * 60_000

/** CONFLICT reasons of the AI suggestion services, as message keys. */
const REASONS = { cap: 'cap', ai_off: 'aiOff', graded: 'graded', not_published: 'notPublished' } as const

/** A refused suggestion request, explained; anything else gets the generic message. */
function SuggestError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('assignments.lecturer.ai.errors')
  if (!state || state.ok) return null
  const reason = state.details?.reason
  if (state.code === 'CONFLICT' && typeof reason === 'string' && Object.hasOwn(REASONS, reason)) {
    return <FieldError>{t(REASONS[reason as keyof typeof REASONS])}</FieldError>
  }
  return <ActionError state={state} />
}

/**
 * "Suggest marks" for every ungraded submission without a suggestion. Hidden when none is
 * eligible, except to keep showing the result of the request just made.
 */
export function SuggestMarksButton({ assignmentId, eligible }: { assignmentId: string; eligible: number }) {
  const t = useTranslations('assignments.lecturer.ai')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult<{ queued: number }> | null>(null)
  if (eligible === 0 && !result && !pending) return null

  const run = () => {
    setResult(null)
    startTransition(async () => setResult(await suggestMarksAction(assignmentId)))
  }

  return (
    <>
      {eligible > 0 && (
        <Button type="button" variant="outline" pending={pending} onClick={run}>
          <Sparkles aria-hidden="true" data-icon="inline-start" />
          {t('suggestMarks')}
        </Button>
      )}
      <p role="status" className={result?.ok ? 'w-full text-sm text-muted-foreground' : 'sr-only'}>
        {result?.ok && t('suggestingCount', { count: result.data.queued })}
      </p>
      {result && !result.ok && (
        <div className="w-full">
          <SuggestError state={result} />
        </div>
      )}
    </>
  )
}

/** "Suggest a mark" / "Try again" for one submission. */
export function SuggestOneButton({ submissionId, retry = false }: { submissionId: string; retry?: boolean }) {
  const t = useTranslations('assignments.lecturer.ai')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult<null> | null>(null)

  const run = () => {
    setResult(null)
    startTransition(async () => setResult(await suggestOneAction(submissionId)))
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" variant="outline" size="sm" pending={pending} onClick={run}>
          {retry ? (
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
          ) : (
            <Sparkles aria-hidden="true" data-icon="inline-start" />
          )}
          {retry ? t('tryAgain') : t('suggestOne')}
        </Button>
      </div>
      <SuggestError state={result} />
    </div>
  )
}

/**
 * Re-renders the page from the server every 10 seconds while mounted (skipping while the tab is
 * hidden), for at most 10 minutes, so AI suggestions in progress show up when they are done.
 */
export function AutoRefresh() {
  const router = useRouter()
  useEffect(() => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= REFRESH_FOR_MS) {
        clearInterval(timer)
        return
      }
      if (document.visibilityState === 'visible') router.refresh()
    }, REFRESH_EVERY_MS)
    return () => clearInterval(timer)
  }, [router])
  return null
}
