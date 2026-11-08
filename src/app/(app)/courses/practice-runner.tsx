'use client'

import { Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Eyebrow } from '@/components/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PracticeQuestionView } from '@/server/revision/authoring'
import { recordPracticeOutcomesAction } from './practice-actions'
import { PracticePill } from './practice-pill'
import { drain, enqueue, type Outcome } from './practice-queue'
import { answer, missed, score, shuffleOptions, startRound, type Round } from './practice-round'

type Started = { round: Round; optionOrder: Record<string, string[]> }

/** Sends queued answers. Only a lost session or no network keeps them: anything else is final. */
async function send(courseId: string, batch: Outcome[]): Promise<boolean> {
  const result = await recordPracticeOutcomesAction(courseId, batch)
  return result.ok || result.code !== 'UNAUTHENTICATED'
}

function begin(questions: Map<string, PracticeQuestionView>, ids: string[]): Started {
  const round = startRound(ids)
  const optionOrder: Record<string, string[]> = {}
  for (const id of round.order) {
    const q = questions.get(id)
    if (q?.kind === 'mcq') optionOrder[id] = shuffleOptions(q.options.map((o) => o.id))
  }
  return { round, optionOrder }
}

/**
 * The student's practice on a phone: one question at a time, shuffled on the device. Each answer
 * is queued in this browser and sent right away, and again when the page opens, so nothing is lost
 * offline. Results are private to the student.
 */
export function PracticeRunner({
  courseId,
  topicTitle,
  questions,
  outcomes,
}: {
  courseId: string
  topicTitle: string
  questions: PracticeQuestionView[]
  outcomes: Record<string, boolean>
}) {
  const t = useTranslations('revision.student')
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions])
  const [started, setStarted] = useState<Started | null>(null)
  // The multiple choice question just answered stays on screen, with its feedback, until "Next".
  const [picked, setPicked] = useState<{ questionId: string; optionId: string } | null>(null)
  const notesHref = `/courses/${encodeURIComponent(courseId)}/notes`
  const missedBefore = questions.filter((q) => outcomes[q.id] === false).map((q) => q.id)

  useEffect(() => {
    void drain(courseId, (batch) => send(courseId, batch))
  }, [courseId])

  const record = (questionId: string, correct: boolean) => {
    enqueue(courseId, { questionId, correct })
    void drain(courseId, (batch) => send(courseId, batch))
  }

  const startWith = (ids: string[]) => {
    setPicked(null)
    setStarted(begin(byId, ids))
  }

  if (questions.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 rounded-3xl border p-5 sm:p-7">
        <h2 className="text-xl font-semibold tracking-tight">{t('emptyTitle')}</h2>
        <p className="text-muted-foreground">{t('emptyBody')}</p>
        <Link href={notesHref} className={buttonVariants({ variant: 'outline' })}>
          {t('readNotes')}
        </Link>
      </div>
    )
  }

  const all = questions.map((q) => q.id)

  if (!started) {
    return (
      <Shell topicTitle={topicTitle} notesHref={notesHref}>
        <div className="flex flex-col gap-5 rounded-3xl border p-5 sm:p-7">
          <h2 className="text-xl font-semibold tracking-tight">{t('introTitle')}</h2>
          <p className="text-muted-foreground">{t('intro', { count: questions.length })}</p>
          <div className="flex flex-col gap-2.5">
            <Button size="lg" onClick={() => startWith(all)}>
              {t('startAll', { count: questions.length })}
            </Button>
            {missedBefore.length > 0 && (
              <Button size="lg" variant="outline" onClick={() => startWith(missedBefore)}>
                {t('startMissed', { count: missedBefore.length })}
              </Button>
            )}
          </div>
        </div>
      </Shell>
    )
  }

  const { round, optionOrder } = started
  const total = round.order.length
  const currentId = picked ? picked.questionId : round.order[round.index]
  const current = currentId === undefined ? undefined : byId.get(currentId)

  if (!current) {
    const wrong = missed(round)
    const { right } = score(round)
    return (
      <Shell topicTitle={topicTitle} notesHref={notesHref}>
        <PhonePracticeDone
          right={right}
          total={total}
          missedQuestions={wrong.map((id) => byId.get(id)).filter((q): q is PracticeQuestionView => !!q)}
          allCount={questions.length}
          notesHref={notesHref}
          onPractiseMissed={() => startWith(wrong)}
          onStartAgain={() => startWith(all)}
        />
      </Shell>
    )
  }

  const number = Math.min(picked ? round.index : round.index + 1, total)
  const finishing = round.index >= total - (picked ? 0 : 1)
  const header = (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
        {t('questionOf', { n: number, total })}
      </span>
      <PracticePill variant="secondary">{t('rightCount', { count: score(round).right })}</PracticePill>
    </div>
  )

  return (
    <Shell topicTitle={topicTitle} notesHref={notesHref}>
      {header}
      {current.kind === 'mcq' ? (
        <PhonePracticeMcq
          key={current.id}
          question={current}
          order={optionOrder[current.id] ?? current.options.map((o) => o.id)}
          pickedId={picked?.optionId ?? null}
          last={finishing}
          onPick={(optionId) => {
            const correct = current.options.find((o) => o.id === optionId)?.isCorrect === true
            setPicked({ questionId: current.id, optionId })
            setStarted({ ...started, round: answer(round, current.id, correct) })
            record(current.id, correct)
          }}
          onNext={() => setPicked(null)}
        />
      ) : (
        <PhonePracticeShort
          key={current.id}
          question={current}
          onAnswer={(correct) => {
            setStarted({ ...started, round: answer(round, current.id, correct) })
            record(current.id, correct)
          }}
        />
      )}
    </Shell>
  )
}

/** Page frame: the "PRACTICE · TOPIC" label and the close button back to the notes. */
function Shell({ topicTitle, notesHref, children }: { topicTitle: string; notesHref: string; children: React.ReactNode }) {
  const t = useTranslations('revision.student')
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow className="min-w-0 break-words">{t('eyebrow', { topic: topicTitle })}</Eyebrow>
        <Link
          href={notesHref}
          aria-label={t('close')}
          title={t('close')}
          className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
        >
          <X aria-hidden="true" />
        </Link>
      </div>
      {children}
    </div>
  )
}

const OPTION =
  'flex min-h-14 w-full items-start gap-3 rounded-2xl border bg-background px-4 py-3 text-left text-base break-words whitespace-normal transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 enabled:hover:bg-muted enabled:active:translate-y-px'

/** A multiple choice question: tap an answer, it locks, the right one is marked. */
function PhonePracticeMcq({
  question,
  order,
  pickedId,
  last,
  onPick,
  onNext,
}: {
  question: PracticeQuestionView
  order: string[]
  pickedId: string | null
  last: boolean
  onPick: (optionId: string) => void
  onNext: () => void
}) {
  const t = useTranslations('revision.student')
  const options = order
    .map((id) => question.options.find((o) => o.id === id))
    .filter((o): o is PracticeQuestionView['options'][number] => !!o)
  const locked = pickedId !== null
  const wasRight = options.find((o) => o.id === pickedId)?.isCorrect === true
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl leading-snug font-semibold break-words whitespace-pre-line">{question.prompt}</h2>
      <fieldset className="flex flex-col gap-2.5" disabled={locked}>
        <legend className="sr-only">{t('optionsLegend')}</legend>
        {options.map((o) => {
          const isPick = o.id === pickedId
          const showRight = locked && o.isCorrect
          const showWrong = locked && isPick && !o.isCorrect
          return (
            <button
              key={o.id}
              type="button"
              disabled={locked}
              aria-pressed={locked ? isPick : undefined}
              onClick={() => onPick(o.id)}
              className={cn(
                OPTION,
                'disabled:cursor-default',
                showRight && 'border-foreground bg-muted',
                showWrong && 'border-destructive bg-destructive/5',
                locked && !showRight && !showWrong && 'text-muted-foreground',
              )}
            >
              <span className="min-w-0 flex-1">{o.text}</span>
              {showRight && (
                <PracticePill variant="default" className="shrink-0">
                  <Check aria-hidden="true" />
                  {t('rightAnswer')}
                </PracticePill>
              )}
              {showWrong && (
                <PracticePill variant="destructive" className="shrink-0">
                  <X aria-hidden="true" />
                  {t('yourAnswer')}
                </PracticePill>
              )}
            </button>
          )
        })}
      </fieldset>
      {locked && (
        <div className="flex flex-col gap-4">
          <div role="status" className="flex flex-col gap-2">
            <p className="text-lg font-semibold">{wasRight ? t('right') : t('notQuite')}</p>
            {question.explanation && <p className="break-words whitespace-pre-line text-muted-foreground">{question.explanation}</p>}
          </div>
          <Button size="lg" autoFocus onClick={onNext}>
            {last ? t('seeScore') : t('next')}
          </Button>
        </div>
      )}
    </div>
  )
}

const TEXTAREA =
  'w-full min-w-0 rounded-2xl border border-input bg-transparent px-4 py-3 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-100'

/** A short answer: write, check against the lecturer's guide, then say how it went. */
function PhonePracticeShort({
  question,
  onAnswer,
}: {
  question: PracticeQuestionView
  onAnswer: (correct: boolean) => void
}) {
  const t = useTranslations('revision.student')
  const [text, setText] = useState('')
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl leading-snug font-semibold break-words whitespace-pre-line">{question.prompt}</h2>
      <div className="flex flex-col gap-2">
        <label htmlFor={`short-${question.id}`} className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
          {t('shortLabel')}
        </label>
        <textarea
          id={`short-${question.id}`}
          rows={4}
          value={text}
          readOnly={revealed}
          placeholder={t('shortPlaceholder')}
          className={TEXTAREA}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {!revealed ? (
        <Button size="lg" onClick={() => setRevealed(true)}>
          {t('check')}
        </Button>
      ) : (
        <div className="flex flex-col gap-4">
          <div role="status" className="flex flex-col gap-3 rounded-2xl bg-muted/60 px-4 py-4">
            <span className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">{t('lookFor')}</span>
            <p className="break-words whitespace-pre-line">{question.guide}</p>
            {question.explanation && (
              <>
                <span className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">{t('explanation')}</span>
                <p className="break-words whitespace-pre-line text-muted-foreground">{question.explanation}</p>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{t('selfCheck')}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Button size="lg" onClick={() => onAnswer(true)}>
              {t('gotIt')}
            </Button>
            <Button size="lg" variant="outline" onClick={() => onAnswer(false)}>
              {t('notYet')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The end of a round: the score, what to look at again, and where to go next. */
function PhonePracticeDone({
  right,
  total,
  missedQuestions,
  allCount,
  notesHref,
  onPractiseMissed,
  onStartAgain,
}: {
  right: number
  total: number
  missedQuestions: PracticeQuestionView[]
  allCount: number
  notesHref: string
  onPractiseMissed: () => void
  onStartAgain: () => void
}) {
  const t = useTranslations('revision.student')
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 rounded-3xl border p-5 text-center sm:p-7">
        <p className="font-display text-7xl leading-none tracking-[0.01em] sm:text-8xl">{t('doneScore', { right, total })}</p>
        <p className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">{t('doneCaption')}</p>
      </div>
      {missedQuestions.length > 0 && (
        <section aria-labelledby="look-again" className="flex flex-col gap-3">
          <h2 id="look-again" className="font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">
            {t('lookAgain')}
          </h2>
          <ul className="flex flex-col divide-y rounded-2xl border">
            {missedQuestions.map((q) => (
              <li key={q.id} className="px-4 py-3 text-sm break-words whitespace-pre-line">
                {q.prompt}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-col gap-2.5">
        {missedQuestions.length > 0 && (
          <Button size="lg" onClick={onPractiseMissed}>
            {t('practiseMissed', { count: missedQuestions.length })}
          </Button>
        )}
        <Button size="lg" variant={missedQuestions.length > 0 ? 'outline' : 'default'} onClick={onStartAgain}>
          {t('startAgain', { count: allCount })}
        </Button>
        <Link href={notesHref} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          {t('readNotes')}
        </Link>
      </div>
    </div>
  )
}
