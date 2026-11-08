'use client'

import { Check, LoaderCircle, Pencil, RotateCw, Save, Sparkles, Unlock } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { ConfirmAction } from '@/components/confirm-action'
import { Eyebrow } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { formatDecimal } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import type { MarkingAnswer, MarkingQuestion } from '@/server/tests/marking'
import { COMMENT_MAX } from '@/server/tests/rules'
import { markSteps, needsSuggestions } from './marking-format'
import { confirmMarkAction, releaseResultsAction, suggestMarksAction } from './test-marking-actions'

// ---------------------------------------------------------------------------------------------
// "Hide names while marking": on by default, remembered on this device
// ---------------------------------------------------------------------------------------------

const HIDE_NAMES_KEY = 'clasync.marking.hideNames'
const hideNamesListeners = new Set<() => void>()
/** Used when the browser refuses storage (private mode): the choice lasts for the visit. */
let hideNamesMemory: boolean | null = null

function readHideNames(): boolean {
  try {
    const stored = window.localStorage.getItem(HIDE_NAMES_KEY)
    if (stored !== null) return stored !== 'false'
  } catch {
    // Storage blocked: fall back to memory.
  }
  return hideNamesMemory ?? true
}

function writeHideNames(value: boolean) {
  hideNamesMemory = value
  try {
    window.localStorage.setItem(HIDE_NAMES_KEY, String(value))
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
  for (const listener of hideNamesListeners) listener()
}

function subscribeHideNames(listener: () => void) {
  hideNamesListeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    hideNamesListeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

function useHideNames(): [boolean, (value: boolean) => void] {
  // Hidden on the server and until the device's choice is read: names never flash.
  const hidden = useSyncExternalStore(subscribeHideNames, readHideNames, () => true)
  return [hidden, writeHideNames]
}

// ---------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------

type SuggestStatus = 'idle' | 'loading' | 'failed'

/**
 * The question and its guide on the left, every real answer on the right. When the lecturer
 * opens the question and some answers have neither a suggestion nor a mark, suggestions are
 * fetched once (never on any other page); a failure offers Try again, and every answer can be
 * marked by hand at any time. Nothing counts until the lecturer confirms it: there is no
 * "accept all".
 */
export function MarkingPanel({ question }: { question: MarkingQuestion }) {
  const t = useTranslations('tests.marking')
  const locale = useLocale()
  const router = useRouter()
  const [hideNames, setHideNames] = useHideNames()
  const [status, setStatus] = useState<SuggestStatus>(() =>
    needsSuggestions(question.aiAvailable, question.answers) ? 'loading' : 'idle',
  )
  const started = useRef(false)
  // The refresh that brings new suggestions in still counts as "getting suggestions".
  const [refreshing, startRefresh] = useTransition()
  const shownStatus: SuggestStatus = refreshing ? 'loading' : status
  const num = (value: number) => formatDecimal(value, locale)
  const max = num(question.maxMark)

  /** Asks for suggestions; the answers that get one show it after the refresh. */
  function requestSuggestions() {
    suggestMarksAction(question.questionId)
      .then((result) => {
        setStatus(!result.ok || result.data.failed ? 'failed' : 'idle')
        if (result.ok && result.data.suggested > 0) startRefresh(() => router.refresh())
      })
      .catch(() => setStatus('failed'))
  }

  function retry() {
    setStatus('loading')
    requestSuggestions()
  }

  const onOpen = useEffectEvent(() => {
    if (started.current || status !== 'loading') return
    started.current = true
    requestSuggestions()
  })
  // Once per opening of the question (the page keys this panel by question), never on load of a list.
  useEffect(() => {
    onOpen()
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{t('privacy')}</span>
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <aside
          aria-labelledby="marking-question"
          className="flex flex-col gap-5 rounded-3xl border bg-card p-5 sm:p-6 lg:sticky lg:top-24"
        >
          <div className="flex flex-col gap-2">
            <Eyebrow>{t('outOf', { max })}</Eyebrow>
            <h2 id="marking-question" className="text-lg leading-snug font-semibold break-words whitespace-pre-wrap">
              {question.prompt}
            </h2>
          </div>
          <div className="flex flex-col gap-1.5 rounded-2xl bg-muted p-4">
            <Eyebrow>{t('guide')}</Eyebrow>
            <p className="text-sm break-words whitespace-pre-wrap">{question.guide || t('noGuide')}</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {t('confirmedCount', { confirmed: question.confirmed, total: question.answers.length })}
            </p>
            {question.blank > 0 && (
              <p className="text-sm text-muted-foreground">{t('blankNote', { count: question.blank })}</p>
            )}
          </div>
          <NamesSwitch checked={hideNames} onChange={setHideNames} label={t('hideNames')} hint={t('hideNamesHint')} />
          <SuggestionStatus status={shownStatus} aiAvailable={question.aiAvailable} onRetry={retry} />
        </aside>

        <section aria-labelledby="marking-answers" className="flex flex-col gap-3">
          <h2 id="marking-answers" className="sr-only">
            {t('answers')}
          </h2>
          {question.answers.length === 0 ? (
            <p className="rounded-3xl border bg-card p-5 text-muted-foreground">{t('noAnswers')}</p>
          ) : (
            question.answers.map((answer, i) => (
              <AnswerCard
                key={answer.attemptId}
                answer={answer}
                questionId={question.questionId}
                maxMark={question.maxMark}
                label={hideNames ? t('student', { n: i + 1 }) : answer.name}
                matricule={hideNames ? null : answer.matricule}
                suggesting={shownStatus === 'loading'}
              />
            ))
          )}
        </section>
      </div>
    </div>
  )
}

function SuggestionStatus({
  status,
  aiAvailable,
  onRetry,
}: {
  status: SuggestStatus
  aiAvailable: boolean
  onRetry: () => void
}) {
  const t = useTranslations('tests.marking')
  if (!aiAvailable) {
    return <p className="text-sm text-muted-foreground">{t('aiOff')}</p>
  }
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-start gap-2 text-sm">
      {status === 'loading' && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          {t('gettingSuggestions')}
        </p>
      )}
      {status === 'failed' && (
        <>
          <p className="font-medium">{t('suggestionsFailed')}</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden="true" data-icon="inline-start" />
            {t('tryAgain')}
          </Button>
        </>
      )}
    </div>
  )
}

/** On/off switch (a button with role="switch"); the whole row is the touch target. */
function NamesSwitch({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean
  label: string
  hint: string
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby="marking-hide-names-label"
      aria-describedby="marking-hide-names-hint"
      onClick={() => onChange(!checked)}
      className="flex min-h-11 items-start gap-3 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'size-5 rounded-full bg-background shadow-sm transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <span id="marking-hide-names-label" className="text-sm font-medium">
          {label}
        </span>
        <span id="marking-hide-names-hint" className="text-sm text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------------------------
// One answer
// ---------------------------------------------------------------------------------------------

function AnswerCard({
  answer,
  questionId,
  maxMark,
  label,
  matricule,
  suggesting,
}: {
  answer: MarkingAnswer
  questionId: string
  maxMark: number
  label: string
  matricule: string | null
  suggesting: boolean
}) {
  const t = useTranslations('tests.marking')
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult<null> | null>(null)
  /** What this card saved last, shown until the refreshed page brings the same values. */
  const [saved, setSaved] = useState<{ mark: number; comment: string | null } | null>(null)
  const [editing, setEditing] = useState(false)
  /** null = untouched: the picker follows the confirmed mark, else the suggestion. */
  const [draftMark, setDraftMark] = useState<string | null>(null)
  const [draftComment, setDraftComment] = useState<string | null>(null)

  const num = (value: number) => formatDecimal(value, locale)
  const max = num(maxMark)
  const mark = saved ? saved.mark : answer.mark
  const comment = saved ? saved.comment : answer.comment
  const confirmed = mark !== null
  const pickerValue = draftMark ?? (mark !== null ? String(mark) : answer.suggestion ? String(answer.suggestion.mark) : '')
  const commentValue = draftComment ?? comment ?? ''
  const idBase = `answer-${answer.attemptId}`

  function submit(value: string) {
    setResult(null)
    startTransition(async () => {
      const r = await confirmMarkAction(answer.attemptId, questionId, value, commentValue)
      setResult(r)
      if (r.ok) {
        setSaved({ mark: Number(value), comment: commentValue.trim() === '' ? null : commentValue.trim() })
        setEditing(false)
        setDraftMark(null)
        setDraftComment(null)
        router.refresh()
      }
    })
  }

  return (
    <article aria-labelledby={`${idBase}-label`} className="flex flex-col gap-4 rounded-3xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${idBase}-label`} className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-medium">
          <span className="break-words">{label}</span>
          {matricule && <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">{matricule}</span>}
        </h3>
        {confirmed ? (
          <Badge variant="secondary">
            <Check aria-hidden="true" />
            {t('confirmed', { mark: num(mark), max })}
          </Badge>
        ) : (
          <Badge variant="outline">{t('toConfirm')}</Badge>
        )}
      </div>

      <p className="break-words whitespace-pre-wrap">{answer.text}</p>

      {answer.suggestion ? (
        <div className="flex items-start gap-2.5 rounded-2xl bg-muted px-4 py-3 text-sm">
          <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <Eyebrow className="text-[11px]">{t('aiLabel')}</Eyebrow>
            <p className="break-words">
              <span className="font-semibold">{t('suggested', { mark: num(answer.suggestion.mark), max })}</span>
              {' — '}
              {answer.suggestion.reason}
            </p>
          </div>
        </div>
      ) : (
        !confirmed &&
        !suggesting && <p className="text-sm text-muted-foreground">{t('noSuggestion')}</p>
      )}

      {confirmed && !editing ? (
        <div className="flex flex-col items-start gap-3 border-t pt-4">
          {comment && <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{comment}</p>}
          <Button type="button" variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" data-icon="inline-start" />
            {t('change')}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit(pickerValue)
          }}
          noValidate
        >
          <div className="flex flex-wrap items-end gap-3">
            {answer.suggestion && !confirmed && (
              <Button
                type="button"
                disabled={pending}
                aria-label={t('confirmLabel', { mark: num(answer.suggestion.mark), student: label })}
                onClick={() => submit(String(answer.suggestion!.mark))}
              >
                <Check aria-hidden="true" data-icon="inline-start" />
                {t('confirm', { mark: num(answer.suggestion.mark) })}
              </Button>
            )}
            <Field className="w-auto min-w-36 gap-1.5" data-invalid={isInvalidField(result, 'mark') || undefined}>
              <FieldLabel htmlFor={`${idBase}-mark`}>{t('mark')}</FieldLabel>
              <NativeSelect
                id={`${idBase}-mark`}
                value={pickerValue}
                onChange={(e) => setDraftMark(e.target.value)}
                aria-invalid={isInvalidField(result, 'mark') || undefined}
                className="font-mono"
              >
                <option value="" disabled>
                  {t('pickMark')}
                </option>
                {markSteps(maxMark).map((step) => (
                  <option key={step} value={String(step)}>
                    {`${num(step)} / ${max}`}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field data-invalid={isInvalidField(result, 'comment') || undefined}>
            <FieldLabel htmlFor={`${idBase}-comment`}>{t('comment')}</FieldLabel>
            <textarea
              id={`${idBase}-comment`}
              rows={2}
              maxLength={COMMENT_MAX}
              value={commentValue}
              onChange={(e) => setDraftComment(e.target.value)}
              aria-invalid={isInvalidField(result, 'comment') || undefined}
              aria-describedby={`${idBase}-comment-hint`}
              className="w-full min-w-0 rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
            />
            <FieldDescription id={`${idBase}-comment-hint`}>{t('commentHint')}</FieldDescription>
          </Field>
          <MarkingError state={result} max={max} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" disabled={pending || pickerValue === ''}>
              <Save aria-hidden="true" data-icon="inline-start" />
              {pending ? t('saving') : t('save')}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setEditing(false)
                  setDraftMark(null)
                  setDraftComment(null)
                  setResult(null)
                }}
              >
                {t('cancel')}
              </Button>
            )}
          </div>
        </form>
      )}
    </article>
  )
}

/** A refused confirmation, explained (the mark's range, the comment's length, answers not final yet). */
function MarkingError({ state, max }: { state: ActionResult<unknown> | null; max: string }) {
  const t = useTranslations('tests.marking.errors')
  if (!state || state.ok) return null
  if (isInvalidField(state, 'mark')) return <FieldError>{t('mark', { max })}</FieldError>
  if (isInvalidField(state, 'comment')) return <FieldError>{t('comment')}</FieldError>
  if (isInvalidField(state, 'answer')) return <FieldError>{t('answer')}</FieldError>
  if (state.code === 'CONFLICT' && state.details?.reason === 'not_final') return <FieldError>{t('notFinal')}</FieldError>
  return <ActionError state={state} />
}

// ---------------------------------------------------------------------------------------------
// Release (results page)
// ---------------------------------------------------------------------------------------------

/** "Release results", behind a confirmation saying students are emailed. */
export function ReleaseResultsButton({ testId }: { testId: string }) {
  const t = useTranslations('tests.release')
  return (
    <ConfirmAction
      action={() => releaseResultsAction(testId)}
      fields={{}}
      primary
      triggerLabel={t('button')}
      triggerIcon={<Unlock aria-hidden="true" data-icon="inline-start" />}
      title={t('title')}
      body={t('body')}
      confirmLabel={t('confirm')}
      renderError={(state) => <ReleaseError state={state} />}
    />
  )
}

/** A refused release, explained: what is left to confirm, answers not final yet, MCQ-only. */
function ReleaseError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('tests.release.errors')
  if (!state || state.ok) return null
  if (state.code === 'CONFLICT') {
    const reason = state.details?.reason
    const count = state.details?.count
    if (reason === 'unmarked' && typeof count === 'number') return <FieldError>{t('unmarked', { count })}</FieldError>
    if (reason === 'not_final') return <FieldError>{t('notFinal')}</FieldError>
    if (reason === 'automatic') return <FieldError>{t('automatic')}</FieldError>
  }
  return <ActionError state={state} />
}
