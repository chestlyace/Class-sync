'use client'

import { ChevronLeft, ChevronRight, Hourglass, Send } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Eyebrow } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDecimal } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import type { PaperQuestion } from '@/server/tests/attempt'
import { SHORT_ANSWER_MAX } from '@/server/tests/rules'
import type { LocalAnswer } from './answer-store'
import { formatCountdown } from './runner-logic'
import { SyncLine, type SyncStatus } from './screen-parts'

export type HandInProblem = 'offline' | 'failed' | null

/** Answering (`PhoneTestQuestion`): one question per screen, the countdown, Previous / Next, Hand in. */
export function QuestionScreen({
  paper,
  index,
  onIndex,
  answers,
  answered,
  msLeft,
  timeUp,
  status,
  onAnswer,
  onHandIn,
  handingIn,
  handInProblem,
}: {
  paper: PaperQuestion[]
  index: number
  onIndex: (index: number) => void
  answers: Record<string, LocalAnswer>
  answered: number
  msLeft: number
  timeUp: boolean
  status: SyncStatus
  onAnswer: (questionId: string, value: { optionId: string | null; text: string | null }) => void
  onHandIn: () => Promise<boolean>
  handingIn: boolean
  handInProblem: HandInProblem
}) {
  const t = useTranslations('tests.student.question')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [confirming, setConfirming] = useState(false)
  const q = paper[Math.min(index, paper.length - 1)]
  const last = index >= paper.length - 1
  const answer = answers[q.id]
  const unanswered = Math.max(0, paper.length - answered)
  const promptId = `prompt-${q.id}`

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Eyebrow>{t('progress', { n: index + 1, total: paper.length, answered })}</Eyebrow>
          <SyncLine status={status} />
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <Eyebrow>{t('timeLeft')}</Eyebrow>
          <span className="font-display text-5xl leading-none tabular-nums" aria-live="off">
            {formatCountdown(msLeft)}
          </span>
        </div>
      </div>

      {timeUp && (
        <p role="alert" className="flex items-center gap-3 rounded-3xl bg-muted p-4 font-medium">
          <Hourglass aria-hidden="true" className="size-5 shrink-0" />
          {t('timeUp')}
        </p>
      )}

      <fieldset className="flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:p-6" disabled={timeUp}>
        <legend className="sr-only">{t('progress', { n: index + 1, total: paper.length, answered })}</legend>
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>{q.kind === 'mcq' ? t('kindMcq') : t('kindShort')}</Eyebrow>
          <span className="rounded-full border px-2.5 py-0.5 font-mono text-xs">
            {t('mark', { n: q.mark, mark: formatDecimal(q.mark, locale) })}
          </span>
        </div>
        <p id={promptId} className="text-lg font-medium whitespace-pre-wrap break-words">
          {q.prompt}
        </p>
        {q.kind === 'mcq' ? (
          <div role="radiogroup" aria-labelledby={promptId} className="flex flex-col gap-2.5">
            {q.options.map((o) => (
              <label
                key={o.id}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors',
                  'has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                  'has-disabled:cursor-default has-disabled:opacity-70',
                )}
              >
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  value={o.id}
                  checked={answer?.optionId === o.id}
                  onChange={() => onAnswer(q.id, { optionId: o.id, text: null })}
                  className="size-5 shrink-0 accent-primary"
                />
                <span className="break-words">{o.text}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`answer-${q.id}`} className="text-sm font-medium">
              {t('answerLabel')}
            </label>
            <textarea
              id={`answer-${q.id}`}
              rows={3}
              maxLength={SHORT_ANSWER_MAX}
              value={answer?.text ?? ''}
              onChange={(e) => onAnswer(q.id, { optionId: null, text: e.target.value })}
              aria-describedby={`counter-${q.id}`}
              className="min-h-24 w-full rounded-2xl border border-input bg-transparent px-4 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
            />
            <span id={`counter-${q.id}`} className="self-end font-mono text-xs text-muted-foreground">
              {t('counter', { count: (answer?.text ?? '').length, max: SHORT_ANSWER_MAX })}
            </span>
          </div>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" size="lg" disabled={index === 0} onClick={() => onIndex(index - 1)}>
          <ChevronLeft aria-hidden="true" data-icon="inline-start" />
          {t('previous')}
        </Button>
        <Button
          type="button"
          variant={last ? 'outline' : 'default'}
          size="lg"
          disabled={last}
          onClick={() => onIndex(index + 1)}
        >
          {t('next')}
          <ChevronRight aria-hidden="true" data-icon="inline-end" />
        </Button>
      </div>

      {!timeUp && (
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <Button
            type="button"
            size="lg"
            variant={last ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setConfirming(true)}
          >
            <Send aria-hidden="true" data-icon="inline-start" />
            {t('handIn')}
          </Button>
          <DialogContent closeLabel={tc('close')}>
            <DialogHeader>
              <DialogTitle>{t('handInTitle')}</DialogTitle>
              <DialogDescription>
                {unanswered === 0 ? t('handInAll') : t('handInUnanswered', { count: unanswered })} {t('handInFinal')}
              </DialogDescription>
            </DialogHeader>
            {handInProblem && (
              <p role="alert" className="text-sm text-destructive">
                {handInProblem === 'offline' ? t('handInOffline') : t('handInFailed')}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {tc('cancel')}
                </Button>
              </DialogClose>
              <Button
                type="button"
                disabled={handingIn}
                onClick={async () => {
                  if (await onHandIn()) setConfirming(false)
                }}
              >
                {handingIn ? t('handingIn') : t('handIn')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
