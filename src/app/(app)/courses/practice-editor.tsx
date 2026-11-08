'use client'

import { ArrowDown, ArrowUp, Check, CircleDot, Copy, Pencil, Plus, Trash2, X, TextCursorInput } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useActionState, useState, useTransition } from 'react'
import { ConfirmAction } from '@/components/confirm-action'
import { SectionHeading } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import type { ActionResult } from '@/lib/action-result'
import { formString } from '@/lib/form-data'
import { submitWith } from '@/lib/form-submit'
import { cn } from '@/lib/utils'
import type { PracticeGroupView, PracticeQuestionView } from '@/server/revision/authoring'
import { EXPLANATION_MAX } from '@/server/revision/rules'
import { GUIDE_MAX, MCQ_OPTIONS_MAX, MCQ_OPTIONS_MIN, OPTION_MAX, PROMPT_MAX } from '@/server/tests/rules'
import {
  addPracticeQuestionAction,
  deletePracticeGroupAction,
  deletePracticeQuestionAction,
  importTestAction,
  movePracticeQuestionAction,
  updatePracticeQuestionAction,
} from './practice-actions'
import { PracticeError } from './practice-error'
import { PracticePill } from './practice-pill'

const TEXTAREA =
  'w-full min-w-0 rounded-xl border border-input bg-transparent px-3.5 py-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm'

type FormAction = (prev: ActionResult<unknown> | null, data: FormData) => Promise<ActionResult<unknown>>
type Importable = { id: string; title: string }

/** The lecturer's practice page body: each set of questions, then adding and bringing in a test. */
export function PracticeEditor({
  topicId,
  groups,
  importable,
}: {
  topicId: string
  groups: PracticeGroupView[]
  importable: Importable[]
}) {
  const t = useTranslations('revision.lecturer')
  const total = groups.reduce((n, g) => n + g.questions.length, 0)
  return (
    <>
      <section aria-labelledby="practice-sets" className="flex flex-col gap-5">
        <SectionHeading id="practice-sets">
          {t('eyebrow')} · {t('count', { count: total })}
        </SectionHeading>
        {groups.length === 0 && <p className="max-w-prose text-muted-foreground">{t('empty')}</p>}
        {groups.map((group) => (
          <RevisionSet key={group.id} group={group} />
        ))}
      </section>

      <section aria-labelledby="practice-add" className="flex flex-col gap-5">
        <SectionHeading id="practice-add">{t('form.addHeading')}</SectionHeading>
        <AddQuestion topicId={topicId} />
      </section>

      <section aria-labelledby="practice-import" className="flex flex-col gap-5">
        <SectionHeading id="practice-import">{t('import.title')}</SectionHeading>
        <ImportTest topicId={topicId} importable={importable} />
      </section>
    </>
  )
}

/** One set of questions: the ones written here, or those brought in from a test. */
function RevisionSet({ group }: { group: PracticeGroupView }) {
  const t = useTranslations('revision.lecturer')
  const title = group.source?.title ?? ''
  return (
    <div className="flex flex-col gap-4 rounded-3xl border p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 font-mono text-xs font-semibold tracking-[0.1em] uppercase break-words">
            {group.source ? t('fromTest', { title }) : t('writtenHere')}
          </h3>
          {group.held && <PracticePill variant="secondary">{t('waiting')}</PracticePill>}
          <span className="font-mono text-xs tracking-[0.04em] text-muted-foreground">
            {t('count', { count: group.questions.length })}
          </span>
        </div>
        {group.source && (
          <ConfirmAction
            action={(_prev, data) => deletePracticeGroupAction(formString(data, 'id'))}
            fields={{ id: group.id }}
            triggerLabel={t('deleteGroup')}
            triggerIcon={<Trash2 aria-hidden="true" data-icon="inline-start" />}
            title={t('deleteGroupTitle', { title })}
            body={t('deleteGroupBody')}
            confirmLabel={t('deleteGroupConfirm')}
            destructive
          />
        )}
      </div>
      {group.held && (
        <p className="text-sm text-muted-foreground">
          {t('heldNote', { test: group.held.testTitle, school: group.held.schoolName, class: group.held.className })}
        </p>
      )}
      {group.questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('emptyGroup')}</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {group.questions.map((question, i) => (
            <li key={question.id}>
              <QuestionCard question={question} n={i + 1} first={i === 0} last={i === group.questions.length - 1} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function KindIcon({ kind, className }: { kind: 'mcq' | 'short'; className?: string }) {
  const Icon = kind === 'mcq' ? CircleDot : TextCursorInput
  return <Icon aria-hidden="true" className={className} />
}

/** A saved question: read view with edit, move and delete; editing swaps in the form. */
function QuestionCard({
  question,
  n,
  first,
  last,
}: {
  question: PracticeQuestionView
  n: number
  first: boolean
  last: boolean
}) {
  const t = useTranslations('revision.lecturer')
  const [editing, setEditing] = useState(false)
  const [moving, startMoving] = useTransition()
  const [moveError, setMoveError] = useState<ActionResult<unknown> | null>(null)
  const move = (dir: 'up' | 'down') =>
    startMoving(async () => {
      setMoveError(await movePracticeQuestionAction(question.id, dir))
    })

  if (editing) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
        <QuestionForm
          kind={question.kind}
          initial={question}
          action={(prev, data) => updatePracticeQuestionAction(question.id, prev, data)}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <article className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.1em] uppercase">
          <KindIcon kind={question.kind} className="size-4 text-muted-foreground" />
          {t('questionN', { n })} · {question.kind === 'mcq' ? t('kindMcq') : t('kindShort')}
        </h4>
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={first || moving}
            aria-label={t('moveUp', { n })}
            title={t('moveUp', { n })}
            onClick={() => move('up')}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={last || moving}
            aria-label={t('moveDown', { n })}
            title={t('moveDown', { n })}
            onClick={() => move('down')}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={t('edit', { n })}
            title={t('edit', { n })}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <ConfirmAction
            action={(_prev, data) => deletePracticeQuestionAction(formString(data, 'id'))}
            fields={{ id: question.id }}
            triggerLabel=""
            triggerAriaLabel={t('delete', { n })}
            triggerIcon={<Trash2 aria-hidden="true" />}
            title={t('deleteTitle')}
            body={t('deleteBody')}
            confirmLabel={t('deleteConfirm')}
            destructive
          />
        </div>
      </div>

      <PracticeError state={moveError} />

      <p className="break-words whitespace-pre-line">{question.prompt}</p>

      {question.kind === 'mcq' ? (
        <ul className="flex flex-col gap-2">
          {question.options.map((o) => (
            <li
              key={o.id}
              className={cn(
                'flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm',
                o.isCorrect ? 'border-foreground bg-muted' : 'text-muted-foreground',
              )}
            >
              <span className="min-w-0 flex-1 break-words">{o.text}</span>
              {o.isCorrect && (
                <PracticePill variant="default" className="shrink-0">
                  <Check aria-hidden="true" />
                  {t('rightAnswer')}
                </PracticePill>
              )}
            </li>
          ))}
        </ul>
      ) : (
        question.guide && (
          <div className="flex flex-col gap-1.5 rounded-xl bg-muted/60 px-3.5 py-3">
            <span className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
              {t('guideLabel')}
            </span>
            <p className="text-sm break-words whitespace-pre-line">{question.guide}</p>
          </div>
        )
      )}

      {question.explanation && (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
            {t('explanationLabel')}
          </span>
          <p className="text-sm break-words whitespace-pre-line">{question.explanation}</p>
        </div>
      )}
    </article>
  )
}

type OptionDraft = { key: number; text: string }

/** Add or edit one question. MCQ: option texts + the ticked right one; short: the model answer. */
function QuestionForm({
  kind,
  initial,
  action,
  onDone,
  onCancel,
}: {
  kind: 'mcq' | 'short'
  initial?: PracticeQuestionView
  action: FormAction
  onDone: () => void
  onCancel: () => void
}) {
  const t = useTranslations('revision.lecturer.form')
  const [nextKey, setNextKey] = useState(() => (initial ? initial.options.length : MCQ_OPTIONS_MIN))
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    initial && initial.kind === 'mcq'
      ? initial.options.map((o, key) => ({ key, text: o.text }))
      : Array.from({ length: MCQ_OPTIONS_MIN }, (_, key) => ({ key, text: '' })),
  )
  const [correct, setCorrect] = useState(() => {
    const at = initial?.options.findIndex((o) => o.isCorrect) ?? -1
    return at < 0 ? null : at
  })
  const [state, dispatch, pending] = useActionState(async (prev: ActionResult<unknown> | null, data: FormData) => {
    const result = await action(prev, data)
    if (result.ok) onDone()
    return result
  }, null)
  const id = initial?.id ?? `new-${kind}`
  const invalid = (field: string) =>
    !!state && !state.ok && state.code === 'VALIDATION' && Array.isArray(state.details?.fields) && state.details.fields.includes(field)

  return (
    <form onSubmit={submitWith(dispatch)} className="flex flex-col gap-5">
      <input type="hidden" name="kind" value={kind} />
      <Field data-invalid={invalid('prompt')}>
        <FieldLabel htmlFor={`${id}-prompt`}>{t('prompt')}</FieldLabel>
        <textarea
          id={`${id}-prompt`}
          name="prompt"
          rows={2}
          maxLength={PROMPT_MAX}
          defaultValue={initial?.prompt ?? ''}
          placeholder={t('promptPlaceholder')}
          aria-invalid={invalid('prompt') || undefined}
          className={TEXTAREA}
        />
      </Field>

      {kind === 'mcq' ? (
        <FieldSet>
          <FieldLegend variant="label">{t('options')}</FieldLegend>
          <FieldDescription>{t('optionsHint', { min: MCQ_OPTIONS_MIN, max: MCQ_OPTIONS_MAX })}</FieldDescription>
          <ul className="flex flex-col gap-2.5">
            {options.map((option, oi) => (
              <li key={option.key} className="flex items-center gap-2">
                <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center" title={t('correct', { n: oi + 1 })}>
                  <input
                    type="radio"
                    name="correct"
                    value={oi}
                    checked={correct === oi}
                    aria-label={t('correct', { n: oi + 1 })}
                    className="size-5 accent-primary"
                    onChange={() => setCorrect(oi)}
                  />
                </label>
                <Input
                  name="option"
                  value={option.text}
                  maxLength={OPTION_MAX}
                  aria-label={t('optionN', { n: oi + 1 })}
                  placeholder={t('optionN', { n: oi + 1 })}
                  aria-invalid={invalid('options') || undefined}
                  onChange={(e) => setOptions((all) => all.map((o, i) => (i === oi ? { ...o, text: e.target.value } : o)))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  disabled={options.length <= MCQ_OPTIONS_MIN}
                  aria-label={t('removeOption', { n: oi + 1 })}
                  title={t('removeOption', { n: oi + 1 })}
                  onClick={() => {
                    setOptions((all) => all.filter((_, i) => i !== oi))
                    setCorrect((c) => (c === null || c === oi ? null : c > oi ? c - 1 : c))
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="self-start"
            disabled={options.length >= MCQ_OPTIONS_MAX}
            onClick={() => {
              setOptions((all) => [...all, { key: nextKey, text: '' }])
              setNextKey((k) => k + 1)
            }}
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addOption')}
          </Button>
        </FieldSet>
      ) : (
        <Field data-invalid={invalid('guide')}>
          <FieldLabel htmlFor={`${id}-guide`}>{t('guide')}</FieldLabel>
          <textarea
            id={`${id}-guide`}
            name="guide"
            rows={3}
            maxLength={GUIDE_MAX}
            defaultValue={initial?.guide ?? ''}
            placeholder={t('guidePlaceholder')}
            aria-invalid={invalid('guide') || undefined}
            className={TEXTAREA}
          />
        </Field>
      )}

      <Field data-invalid={invalid('explanation')}>
        <FieldLabel htmlFor={`${id}-explanation`}>{t('explanation')}</FieldLabel>
        <textarea
          id={`${id}-explanation`}
          name="explanation"
          rows={2}
          maxLength={EXPLANATION_MAX}
          defaultValue={initial?.explanation ?? ''}
          placeholder={t('explanationPlaceholder')}
          aria-invalid={invalid('explanation') || undefined}
          className={TEXTAREA}
        />
      </Field>

      <PracticeError state={state} />
      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t('saving') : initial ? t('save') : t('add')}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}

/** Two buttons, one per kind; choosing one opens its form. */
function AddQuestion({ topicId }: { topicId: string }) {
  const t = useTranslations('revision.lecturer.form')
  const [kind, setKind] = useState<'mcq' | 'short' | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2.5">
        <Button type="button" size="lg" variant={kind === 'mcq' ? 'default' : 'outline'} aria-pressed={kind === 'mcq'} onClick={() => setKind('mcq')}>
          <CircleDot aria-hidden="true" data-icon="inline-start" />
          {t('addMcq')}
        </Button>
        <Button type="button" size="lg" variant={kind === 'short' ? 'default' : 'outline'} aria-pressed={kind === 'short'} onClick={() => setKind('short')}>
          <TextCursorInput aria-hidden="true" data-icon="inline-start" />
          {t('addShort')}
        </Button>
      </div>
      {kind && (
        <div className="rounded-2xl border bg-card p-4 sm:p-5">
          <QuestionForm
            key={kind}
            kind={kind}
            action={(prev, data) => addPracticeQuestionAction(topicId, prev, data)}
            onDone={() => setKind(null)}
            onCancel={() => setKind(null)}
          />
        </div>
      )}
    </div>
  )
}

/** "Bring in a finished test": copies its questions into this topic as a held-or-shown set. */
function ImportTest({ topicId, importable }: { topicId: string; importable: Importable[] }) {
  const t = useTranslations('revision.lecturer.import')
  const [state, dispatch, pending] = useActionState(
    (_prev: ActionResult<{ count: number }> | null, data: FormData) => importTestAction(topicId, formString(data, 'testId')),
    null,
  )
  if (importable.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PracticeError state={state} />
        {state?.ok ? (
          <p role="status" className="text-sm font-medium">{t('done', { count: state.data.count })}</p>
        ) : null}
        <p className="max-w-prose text-sm text-muted-foreground">{t('none')}</p>
      </div>
    )
  }
  return (
    <form onSubmit={submitWith(dispatch)} className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="import-test">{t('test')}</FieldLabel>
        <NativeSelect id="import-test" name="testId" defaultValue={importable[0].id} aria-describedby="import-test-hint">
          {importable.map((test) => (
            <option key={test.id} value={test.id}>
              {test.title}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription id="import-test-hint">{t('hint')}</FieldDescription>
      </Field>
      <PracticeError state={state} />
      {state?.ok && (
        <p role="status" className="text-sm font-medium">
          {t('done', { count: state.data.count })}
        </p>
      )}
      <Button type="submit" variant="outline" size="lg" className="self-start" disabled={pending}>
        <Copy aria-hidden="true" data-icon="inline-start" />
        {pending ? t('copying') : t('submit')}
      </Button>
    </form>
  )
}
