'use client'

import { ArrowDown, ArrowUp, CircleDot, Copy, Plus, RotateCcw, Save, TextCursorInput, Trash2, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { clearDraft, loadDraft, saveDraft } from '@/lib/draft-store'
import { formString } from '@/lib/form-data'
import { submitWith } from '@/lib/form-submit'
import { formatDecimal } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import {
  GUIDE_MAX,
  MAX_QUESTIONS,
  MCQ_OPTIONS_MAX,
  MCQ_OPTIONS_MIN,
  OPTION_MAX,
  PROMPT_MAX,
  TITLE_MAX,
} from '@/server/tests/rules'
import { copyTestAction, saveTestAction } from './test-actions'
import { TestError } from './test-error'
import {
  blankOption,
  blankQuestion,
  editorTotal,
  emptyEditorValues,
  testDraftKey,
  toEditorDraft,
  toEditorValues,
  type EditorQuestion,
  type EditorValues,
  type SavedTestInput,
} from './test-form'

const TEXTAREA =
  'w-full min-w-0 rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm'

function sameValues(a: EditorValues, b: EditorValues): boolean {
  const strip = (v: EditorValues) => ({
    ...v,
    questions: v.questions.map((q) => ({ ...q, key: '', options: q.options.map((o) => ({ ...o, key: '' })) })),
  })
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

/**
 * The new / edit test editor. Every change is kept as a draft in this browser (per user and test)
 * and offered back after a reload; a successful save clears it and opens the test's live page,
 * where the link is.
 */
export function TestEditor({
  courseId,
  testId,
  userId,
  saved,
}: {
  courseId: string
  testId: string | null
  userId: string
  /** The saved test (edit), or null for a new one. */
  saved: SavedTestInput | null
}) {
  const t = useTranslations('tests.lecturer.editor')
  const locale = useLocale()
  const router = useRouter()
  const draftKey = testDraftKey(userId, testId ? { testId } : { courseId })
  const [values, setValues] = useState<EditorValues>(() => (saved ? toEditorValues(saved, locale) : emptyEditorValues()))
  const [offer, setOffer] = useState<EditorValues | null>(null)
  const [state, setState] = useState<ActionResult<{ testId: string }> | null>(null)
  const [pending, startSaving] = useTransition()
  const dirty = useRef(false)

  // Offer back unsaved work from an earlier visit, when it differs from what is saved.
  useEffect(() => {
    const draft = toEditorDraft(loadDraft(draftKey))
    if (!draft || sameValues(draft, values)) return
    // Runs once after mount: the draft only exists in this browser, so it can't be server-rendered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffer(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  // Keep every change as a draft.
  useEffect(() => {
    if (dirty.current) saveDraft(draftKey, values)
  }, [draftKey, values])

  function update(change: (v: EditorValues) => EditorValues) {
    dirty.current = true
    setOffer(null) // typing over an old draft replaces it
    setValues(change)
  }

  function updateQuestion(index: number, change: (q: EditorQuestion) => EditorQuestion) {
    update((v) => ({ ...v, questions: v.questions.map((q, i) => (i === index ? change(q) : q)) }))
  }

  function moveQuestion(index: number, by: -1 | 1) {
    update((v) => {
      const questions = [...v.questions]
      const [moved] = questions.splice(index, 1)
      questions.splice(index + by, 0, moved)
      return { ...v, questions }
    })
  }

  function restore() {
    if (!offer) return
    setValues(offer)
    setOffer(null)
    dirty.current = true
  }

  function discard() {
    clearDraft(draftKey)
    setOffer(null)
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startSaving(async () => {
      const result = await saveTestAction(courseId, testId, values)
      setState(result)
      if (!result.ok) return
      clearDraft(draftKey)
      dirty.current = false
      router.push(`/courses/${encodeURIComponent(courseId)}/tests/${encodeURIComponent(result.data.testId)}`)
    })
  }

  const total = editorTotal(values)
  const hasShort = values.questions.some((q) => q.kind === 'short')
  const defaultMarkText = values.defaultMark.trim() || '—'
  const failedQuestion =
    state && !state.ok && typeof state.details?.question === 'number' ? state.details.question : null
  const failedReason = state && !state.ok ? state.details?.reason : undefined
  const invalid = (reason: string) => failedQuestion === null && failedReason === reason ? true : undefined

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      {offer && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-3xl border bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
        >
          <p className="text-sm">{t('draftFound')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={restore}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {t('draftRestore')}
            </Button>
            <Button type="button" variant="ghost" onClick={discard}>
              {t('draftDiscard')}
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="rounded-3xl border bg-card p-5 sm:p-7">
            <Field data-invalid={invalid('title')}>
              <FieldLabel htmlFor="test-title">{t('title')}</FieldLabel>
              <Input
                id="test-title"
                value={values.title}
                maxLength={TITLE_MAX}
                placeholder={t('titlePlaceholder')}
                aria-invalid={invalid('title')}
                onChange={(e) => update((v) => ({ ...v, title: e.target.value }))}
              />
            </Field>
          </div>

          <ol className="flex flex-col gap-4" aria-label={t('questions')}>
            {values.questions.map((q, index) => (
              <li key={q.key}>
                <QuestionCard
                  question={q}
                  index={index}
                  count={values.questions.length}
                  defaultMark={defaultMarkText}
                  invalid={failedQuestion === index}
                  onChange={(change) => updateQuestion(index, change)}
                  onMove={(by) => moveQuestion(index, by)}
                  onRemove={() => update((v) => ({ ...v, questions: v.questions.filter((_, i) => i !== index) }))}
                />
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-2.5">
            {(['mcq', 'short'] as const).map((kind) => (
              <Button
                key={kind}
                type="button"
                variant="outline"
                disabled={values.questions.length >= MAX_QUESTIONS}
                onClick={() => update((v) => ({ ...v, questions: [...v.questions, blankQuestion(kind)] }))}
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {kind === 'mcq' ? t('addMcq') : t('addShort')}
              </Button>
            ))}
          </div>
        </div>

        <aside className="flex flex-col gap-5 rounded-3xl border bg-card p-5 sm:p-7 lg:sticky lg:top-24">
          <h2 className="font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">{t('settings')}</h2>
          <FieldGroup className="gap-5">
            <div className="grid grid-cols-2 gap-4">
              <Field data-invalid={invalid('duration')}>
                <FieldLabel htmlFor="test-duration">{t('duration')}</FieldLabel>
                <Input
                  id="test-duration"
                  inputMode="numeric"
                  value={values.durationMinutes}
                  aria-invalid={invalid('duration')}
                  className="font-mono"
                  onChange={(e) => update((v) => ({ ...v, durationMinutes: e.target.value }))}
                />
              </Field>
              <Field data-invalid={invalid('mark')}>
                <FieldLabel htmlFor="test-default-mark">{t('defaultMark')}</FieldLabel>
                <Input
                  id="test-default-mark"
                  inputMode="decimal"
                  value={values.defaultMark}
                  aria-invalid={invalid('mark')}
                  className="font-mono"
                  onChange={(e) => update((v) => ({ ...v, defaultMark: e.target.value }))}
                />
              </Field>
            </div>

            <p aria-live="polite" className="text-lg font-semibold">
              {total === null ? t('totalUnknown') : t('total', { total: formatDecimal(total, locale), count: total })}
            </p>

            <ShuffleSwitch
              checked={values.shuffle}
              label={t('shuffle')}
              hint={t('shuffleHint')}
              onChange={(shuffle) => update((v) => ({ ...v, shuffle }))}
            />

            <FieldSet data-invalid={invalid('leaving')}>
              <FieldLegend variant="label">{t('leaving')}</FieldLegend>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm leading-relaxed">
                <span>{t('leavingBefore')}</span>
                <Input
                  inputMode="numeric"
                  value={values.maxExits}
                  aria-label={t('maxExits')}
                  aria-invalid={invalid('leaving')}
                  className="h-11 w-16 text-center font-mono"
                  onChange={(e) => update((v) => ({ ...v, maxExits: e.target.value }))}
                />
                <span>{t('leavingMiddle')}</span>
                <Input
                  inputMode="numeric"
                  value={values.maxAbsenceSeconds}
                  aria-label={t('maxAbsence')}
                  aria-invalid={invalid('leaving')}
                  className="h-11 w-16 text-center font-mono"
                  onChange={(e) => update((v) => ({ ...v, maxAbsenceSeconds: e.target.value }))}
                />
                <span>{t('leavingAfter')}</span>
              </p>
              <FieldDescription>{t('leavingHint')}</FieldDescription>
            </FieldSet>

            <p className="text-sm text-muted-foreground">{hasShort ? t('shortNote') : t('mcqNote')}</p>
          </FieldGroup>

          <TestError state={state} />
          <Button type="submit" size="lg" disabled={pending}>
            <Save aria-hidden="true" data-icon="inline-start" />
            {pending ? t('saving') : t('save')}
          </Button>
        </aside>
      </div>
    </form>
  )
}

/** On/off switch (a button with role="switch"); the whole row is the touch target. */
function ShuffleSwitch({
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
      aria-describedby="test-shuffle-hint"
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
        <span className="text-sm font-medium">{label}</span>
        <span id="test-shuffle-hint" className="text-sm text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  )
}

function QuestionCard({
  question,
  index,
  count,
  defaultMark,
  invalid,
  onChange,
  onMove,
  onRemove,
}: {
  question: EditorQuestion
  index: number
  count: number
  defaultMark: string
  invalid: boolean
  onChange: (change: (q: EditorQuestion) => EditorQuestion) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) {
  const t = useTranslations('tests.lecturer.editor')
  const n = index + 1
  const id = `q${index}`
  const KindIcon = question.kind === 'mcq' ? CircleDot : TextCursorInput

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={cn('flex flex-col gap-5 rounded-3xl border bg-card p-5 sm:p-6', invalid && 'border-destructive')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-heading`} className="flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.1em] uppercase">
          <KindIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          {t('questionN', { n })} · {question.kind === 'mcq' ? t('kindMcq') : t('kindShort')}
        </h3>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={index === 0}
            aria-label={t('moveUp', { n })}
            title={t('moveUp', { n })}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={index === count - 1}
            aria-label={t('moveDown', { n })}
            title={t('moveDown', { n })}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={count === 1}
            aria-label={t('remove', { n })}
            title={t('remove', { n })}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Field>
        <FieldLabel htmlFor={`${id}-prompt`}>{t('prompt')}</FieldLabel>
        <textarea
          id={`${id}-prompt`}
          rows={2}
          maxLength={PROMPT_MAX}
          value={question.prompt}
          placeholder={t('promptPlaceholder')}
          className={TEXTAREA}
          onChange={(e) => onChange((q) => ({ ...q, prompt: e.target.value }))}
        />
      </Field>

      {question.kind === 'mcq' ? (
        <FieldSet>
          <FieldLegend variant="label">{t('options')}</FieldLegend>
          <FieldDescription>{t('optionsHint', { min: MCQ_OPTIONS_MIN, max: MCQ_OPTIONS_MAX })}</FieldDescription>
          <ul className="flex flex-col gap-2.5">
            {question.options.map((option, oi) => (
              <li key={option.key} className="flex items-center gap-2">
                <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center" title={t('correct', { n: oi + 1 })}>
                  <input
                    type="radio"
                    name={`${id}-correct`}
                    checked={option.correct}
                    aria-label={t('correct', { n: oi + 1 })}
                    className="size-5 accent-primary"
                    onChange={() =>
                      onChange((q) => ({ ...q, options: q.options.map((o, i) => ({ ...o, correct: i === oi })) }))
                    }
                  />
                </label>
                <Input
                  value={option.text}
                  maxLength={OPTION_MAX}
                  aria-label={t('optionN', { n: oi + 1 })}
                  placeholder={t('optionN', { n: oi + 1 })}
                  onChange={(e) =>
                    onChange((q) => ({
                      ...q,
                      options: q.options.map((o, i) => (i === oi ? { ...o, text: e.target.value } : o)),
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  disabled={question.options.length <= MCQ_OPTIONS_MIN}
                  aria-label={t('removeOption', { n: oi + 1 })}
                  title={t('removeOption', { n: oi + 1 })}
                  onClick={() => onChange((q) => ({ ...q, options: q.options.filter((_, i) => i !== oi) }))}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={question.options.length >= MCQ_OPTIONS_MAX}
            onClick={() => onChange((q) => ({ ...q, options: [...q.options, blankOption()] }))}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addOption')}
          </Button>
        </FieldSet>
      ) : (
        <Field>
          <FieldLabel htmlFor={`${id}-guide`}>{t('guide')}</FieldLabel>
          <textarea
            id={`${id}-guide`}
            rows={3}
            maxLength={GUIDE_MAX}
            value={question.guide}
            placeholder={t('guidePlaceholder')}
            className={TEXTAREA}
            onChange={(e) => onChange((q) => ({ ...q, guide: e.target.value }))}
          />
        </Field>
      )}

      <Field className="max-w-48">
        <FieldLabel htmlFor={`${id}-mark`}>{t('mark')}</FieldLabel>
        <Input
          id={`${id}-mark`}
          inputMode="decimal"
          value={question.mark}
          placeholder={t('markDefault', { mark: defaultMark })}
          aria-describedby={`${id}-mark-hint`}
          className="font-mono"
          onChange={(e) => onChange((q) => ({ ...q, mark: e.target.value }))}
        />
        <FieldDescription id={`${id}-mark-hint`}>{t('markHint')}</FieldDescription>
      </Field>
    </section>
  )
}

/** "Copy to another course": a select of my other courses; the copy opens in its editor. */
export function CopyTestForm({
  testId,
  courses,
}: {
  testId: string
  courses: { id: string; label: string }[]
}) {
  const t = useTranslations('tests.lecturer.copy')
  const [state, dispatch, pending] = useActionState(
    (_prev: ActionResult<never> | null, data: FormData) => copyTestAction(testId, formString(data, 'courseId')),
    null,
  )
  if (courses.length === 0) return <p className="text-sm text-muted-foreground">{t('noCourses')}</p>
  return (
    <form onSubmit={submitWith(dispatch)} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="copy-course">{t('course')}</FieldLabel>
        <NativeSelect id="copy-course" name="courseId" defaultValue={courses[0].id} aria-describedby="copy-course-hint">
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription id="copy-course-hint">{t('hint')}</FieldDescription>
      </Field>
      <TestError state={state} />
      <Button type="submit" variant="outline" className="self-start" disabled={pending}>
        <Copy aria-hidden="true" data-icon="inline-start" />
        {pending ? t('copying') : t('submit')}
      </Button>
    </form>
  )
}
