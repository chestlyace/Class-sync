'use client'

import { BookmarkPlus, Check, Plus, Save, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { startTransition, useActionState, useRef, useState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { formatDecimal } from '@/lib/number-format'
import {
  GROUP_NAME_MAX,
  MAX_GROUPS,
  TESTS_BEST_OF_MAX,
  TESTS_BEST_OF_MIN,
  type CaSettings,
} from '@/server/performance/rules'
import type { CaTemplate, DefaultTemplate } from '@/server/performance/templates'
import { CaTemplatePicker, type TemplateCard } from './ca-template-picker'
import { createCaTemplateAction, updateCaSettingsAction } from './performance-actions'
import {
  parseDecimalInput,
  POINT_FIELDS,
  SETTINGS_FIELDS,
  sumInCents,
  type GroupDraft,
  type PointField,
  type SettingsField,
} from './performance-form'

/** VALIDATION reasons of `updateCaSettings`. */
const REASONS = ['sum', 'range', 'decimals', 'shape', 'groupName', 'groups'] as const
type Reason = (typeof REASONS)[number]

const LABELS: Record<PointField, 'attendance' | 'assignments' | 'participation' | 'tests'> = {
  attendancePoints: 'attendance',
  assignmentPoints: 'assignments',
  participationPoints: 'participation',
  testPoints: 'tests',
}

type Values = Record<Exclude<SettingsField, 'groups'>, string>

function reasonOf(state: ActionResult<unknown> | null): Reason | undefined {
  if (!state || state.ok || state.code !== 'VALIDATION') return undefined
  const reason = state.details?.reason
  return REASONS.find((r) => r === reason)
}

/** A refused save, explained: the service's reason or the boxes that held no number. */
function SettingsError({ state }: { state: ActionResult<unknown> | null }) {
  const t = useTranslations('performance.lecturer.settings.errors')
  const locale = useLocale()
  if (!state || state.ok) return null
  const reason = reasonOf(state)
  if (reason) return <FieldError>{t(reason, { example: formatDecimal(7.25, locale), max: MAX_GROUPS })}</FieldError>
  if (SETTINGS_FIELDS.some((f) => isInvalidField(state, f))) return <FieldError>{t('fields')}</FieldError>
  return <ActionError state={state} />
}

let keyCounter = 0
function newKey(): string {
  keyCounter += 1
  return `g${keyCounter}`
}

/**
 * The form's values for these settings. `key` makes the named CAs' React keys (and input ids):
 * the first render uses their position, the same on the server and in the browser.
 */
function valuesOf(s: CaSettings, key: (i: number) => string = newKey): { values: Values; groups: GroupDraft[] } {
  return {
    values: {
      total: String(s.total),
      attendancePoints: String(s.attendancePoints),
      assignmentPoints: String(s.assignmentPoints),
      participationPoints: String(s.participationPoints),
      testPoints: String(s.testPoints),
      participationTarget: String(s.participationTarget),
      testsBestOf: s.testsBestOf === null ? '' : String(s.testsBestOf),
    },
    groups: s.groups.map((g, i) => ({
      key: key(i),
      id: g.id,
      name: g.name,
      points: String(g.points),
      bestOf: g.bestOf === null ? '' : String(g.bestOf),
    })),
  }
}

/**
 * The course's CA split: total, points per component, the participation target and how many
 * tests count ("best N", blank for all). The tests part can be split into named CAs ("CA 1",
 * "CA 2"), each with its points and best N; the test points are then their sum. A template card
 * (built-in or one of mine, at the top) fills the form in; nothing is saved until Save. "Save as template"
 * keeps the form as typed under a name. A live helper adds the parts up (in cents, like the
 * server); Save stays enabled, the server decides.
 */
export function CaSettingsForm({
  courseId,
  initial,
  templates,
  defaultTemplate,
  courses,
}: {
  courseId: string
  initial: CaSettings
  templates: CaTemplate[]
  defaultTemplate: DefaultTemplate
  /** My courses, where a template can be applied at once. */
  courses: { id: string; label: string }[]
}) {
  const t = useTranslations('performance.lecturer.settings')
  const tTemplates = useTranslations('performance.lecturer.templates')
  const locale = useLocale()
  const formRef = useRef<HTMLFormElement>(null)
  const [{ values, groups }, setForm] = useState(() => valuesOf(initial, (i) => `saved${i}`))
  const [edited, setEdited] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [filledFrom, setFilledFrom] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [state, dispatch, pending] = useActionState(
    (prev: ActionResult<CaSettings> | null, data: FormData) => {
      setEdited(false)
      setFilledFrom(null)
      return updateCaSettingsAction(courseId, prev, data)
    },
    null,
  )
  const [templateState, saveTemplate, savingTemplate] = useActionState(
    async (prev: ActionResult<CaTemplate> | null, data: FormData) => {
      const result = await createCaTemplateAction(prev, data)
      if (result.ok) setTemplateName('')
      return result
    },
    null,
  )
  const reason = reasonOf(state)
  const invalid = (field: SettingsField) => {
    if (isInvalidField(state, field)) return true
    if (reason === 'sum') return (field !== 'participationTarget' && field !== 'testsBestOf') || undefined
    if ((reason === 'groupName' || reason === 'groups') && field === 'groups') return true
    return undefined
  }

  const split = groups.length > 0
  const groupSum = sumInCents(groups.map((g) => parseDecimalInput(g.points))) / 100
  const pointValue = (f: PointField) => (f === 'testPoints' && split ? groupSum : parseDecimalInput(values[f]))
  const sum = sumInCents(POINT_FIELDS.map(pointValue)) / 100
  const total = parseDecimalInput(values.total)
  const matches = Number.isFinite(total) && Math.round(total * 100) === Math.round(sum * 100)
  const groupsJson = JSON.stringify(groups.map(({ id, name, points, bestOf }) => ({ id, name, points, bestOf })))

  function set(field: keyof Values, value: string) {
    setForm((f) => ({ ...f, values: { ...f.values, [field]: value } }))
    setEdited(true)
  }

  function setGroups(change: (list: GroupDraft[]) => GroupDraft[]) {
    setForm((f) => ({ ...f, groups: change(f.groups) }))
    setEdited(true)
  }

  function addGroup() {
    setGroups((list) => [
      ...list,
      { key: newKey(), id: null, name: tTemplates('groupName', { n: list.length + 1 }), points: '0', bestOf: '' },
    ])
  }

  /** Fills the form with a template; the named CAs keep their ids when the names match (as the server does). */
  function applyTemplate(card: TemplateCard) {
    const next = valuesOf(card.settings)
    next.groups = next.groups.map((g) => ({
      ...g,
      id: groups.find((old) => old.id !== null && old.name.toLowerCase() === g.name.toLowerCase())?.id ?? null,
    }))
    setForm(next)
    setEdited(true)
    setSelectedKey(card.key)
    setFilledFrom(card.name)
  }

  function saveAsTemplate() {
    if (!formRef.current) return
    const data = new FormData(formRef.current)
    data.set('templateName', templateName)
    startTransition(() => saveTemplate(data))
  }

  return (
    <form ref={formRef} onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-6">
      <CaTemplatePicker
        templates={templates}
        defaultTemplate={defaultTemplate}
        courses={courses}
        currentCourseId={courseId}
        locale={locale}
        selectedKey={selectedKey}
        onSelect={applyTemplate}
      />
      {filledFrom && (
        <p role="status" className="-mt-3 text-sm text-muted-foreground">
          {tTemplates('filled', { name: filledFrom })}
        </p>
      )}

      <FieldGroup>
        <Field data-invalid={invalid('total')}>
          <FieldLabel htmlFor="ca-total">{t('total')}</FieldLabel>
          <Input
            id="ca-total"
            name="total"
            type="number"
            inputMode="decimal"
            required
            min={1}
            max={100}
            step={0.01}
            value={values.total}
            onChange={(e) => set('total', e.target.value)}
            aria-invalid={invalid('total')}
            className="font-mono sm:max-w-48"
          />
        </Field>

        <fieldset className="flex flex-col gap-3" aria-describedby="ca-sum-helper">
          <legend className="mb-3 font-medium">{t('parts')}</legend>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {POINT_FIELDS.map((field) => {
              const fromGroups = field === 'testPoints' && split
              return (
                <Field key={field} data-invalid={fromGroups ? undefined : invalid(field)}>
                  <FieldLabel htmlFor={`ca-${field}`}>{t(LABELS[field])}</FieldLabel>
                  <Input
                    id={`ca-${field}`}
                    name={field}
                    type="number"
                    inputMode="decimal"
                    required
                    min={0}
                    max={100}
                    step={0.01}
                    readOnly={fromGroups}
                    value={fromGroups ? String(groupSum) : values[field]}
                    onChange={(e) => set(field, e.target.value)}
                    aria-invalid={fromGroups ? undefined : invalid(field)}
                    aria-describedby={fromGroups ? 'ca-tests-from-groups' : undefined}
                    className="font-mono read-only:bg-muted/60"
                  />
                  {fromGroups && (
                    <FieldDescription id="ca-tests-from-groups">{t('testsFromGroups')}</FieldDescription>
                  )}
                </Field>
              )
            })}
          </div>
          <p id="ca-sum-helper" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {matches && <Check aria-hidden="true" className="size-4 shrink-0 text-primary" />}
            <span>
              {Number.isFinite(total)
                ? t('sumHelper', { sum: formatDecimal(sum, locale), total: formatDecimal(total, locale) })
                : t('sumHelperNoTotal', { sum: formatDecimal(sum, locale) })}
            </span>
          </p>
          <FieldDescription>{t('dropHint')}</FieldDescription>
        </fieldset>

        <FieldSet data-invalid={invalid('groups')}>
          <FieldLegend variant="label">{t('groups.legend')}</FieldLegend>
          <FieldDescription>{split ? t('groups.hintSplit') : t('groups.hint')}</FieldDescription>
          <input type="hidden" name="groups" value={groupsJson} />
          {split && (
            <ol className="flex flex-col gap-3" aria-label={t('groups.listLabel')}>
              {groups.map((g, i) => (
                <li key={g.key} data-testid="ca-group" className="grid gap-3 rounded-2xl border p-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end">
                  <Field>
                    <FieldLabel htmlFor={`ca-group-name-${g.key}`}>{t('groups.name')}</FieldLabel>
                    <Input
                      id={`ca-group-name-${g.key}`}
                      value={g.name}
                      maxLength={GROUP_NAME_MAX}
                      aria-invalid={invalid('groups')}
                      onChange={(e) => setGroups((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`ca-group-points-${g.key}`}>{t('groups.points')}</FieldLabel>
                    <Input
                      id={`ca-group-points-${g.key}`}
                      inputMode="decimal"
                      value={g.points}
                      aria-invalid={invalid('groups')}
                      className="font-mono"
                      onChange={(e) => setGroups((list) => list.map((x, j) => (j === i ? { ...x, points: e.target.value } : x)))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`ca-group-best-${g.key}`}>{t('groups.bestOf')}</FieldLabel>
                    <Input
                      id={`ca-group-best-${g.key}`}
                      inputMode="numeric"
                      value={g.bestOf}
                      placeholder={t('groups.bestOfAll')}
                      aria-invalid={invalid('groups')}
                      className="font-mono"
                      onChange={(e) => setGroups((list) => list.map((x, j) => (j === i ? { ...x, bestOf: e.target.value } : x)))}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('groups.remove', { name: g.name || String(i + 1) })}
                    title={t('groups.remove', { name: g.name || String(i + 1) })}
                    onClick={() => setGroups((list) => list.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <div>
            <Button type="button" variant="outline" disabled={groups.length >= MAX_GROUPS} onClick={addGroup}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {split ? t('groups.add') : t('groups.split')}
            </Button>
          </div>
          {split && <FieldDescription>{t('groups.removeHint')}</FieldDescription>}
        </FieldSet>

        <Field data-invalid={invalid('participationTarget')}>
          <FieldLabel htmlFor="ca-target">{t('target')}</FieldLabel>
          <Input
            id="ca-target"
            name="participationTarget"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={100}
            step={1}
            value={values.participationTarget}
            onChange={(e) => set('participationTarget', e.target.value)}
            aria-invalid={invalid('participationTarget')}
            aria-describedby="ca-target-hint"
            className="font-mono sm:max-w-48"
          />
          <FieldDescription id="ca-target-hint">{t('targetHint')}</FieldDescription>
        </Field>

        {split ? (
          <input type="hidden" name="testsBestOf" value="" />
        ) : (
          <FieldSet data-invalid={invalid('testsBestOf')}>
            <FieldLegend variant="label">{t('bestOfLegend')}</FieldLegend>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm leading-relaxed">
              <span>{t('bestOfBefore')}</span>
              <Input
                id="ca-tests-best-of"
                name="testsBestOf"
                type="number"
                inputMode="numeric"
                min={TESTS_BEST_OF_MIN}
                max={TESTS_BEST_OF_MAX}
                step={1}
                value={values.testsBestOf}
                onChange={(e) => set('testsBestOf', e.target.value)}
                aria-label={t('bestOf')}
                aria-invalid={invalid('testsBestOf')}
                aria-describedby="ca-tests-best-of-hint"
                className="h-11 w-20 text-center font-mono"
              />
              <span>{t('bestOfAfter')}</span>
            </p>
            <FieldDescription id="ca-tests-best-of-hint">{t('bestOfHint')}</FieldDescription>
          </FieldSet>
        )}
      </FieldGroup>

      <SettingsError state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending}>
          <Save aria-hidden="true" data-icon="inline-start" />
          {pending ? t('saving') : t('save')}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {state?.ok && !edited ? t('saved') : edited && filledFrom ? tTemplates('notSavedYet') : ''}
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t pt-5">
        <Field data-invalid={isInvalidField(templateState, 'name') || undefined}>
          <FieldLabel htmlFor="ca-template-name">{tTemplates('saveAsLabel')}</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="ca-template-name"
              value={templateName}
              maxLength={60}
              placeholder={tTemplates('namePlaceholder')}
              aria-invalid={isInvalidField(templateState, 'name') || undefined}
              aria-describedby="ca-template-name-hint"
              className="min-w-0 sm:w-72"
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <Button type="button" variant="outline" pending={savingTemplate} onClick={saveAsTemplate}>
              <BookmarkPlus aria-hidden="true" data-icon="inline-start" />
              {tTemplates('saveAs')}
            </Button>
          </div>
          <FieldDescription id="ca-template-name-hint">{tTemplates('saveAsHint')}</FieldDescription>
        </Field>
        {templateState && !templateState.ok ? (
          templateState.code === 'CONFLICT' ? (
            <FieldError>{tTemplates('nameTaken')}</FieldError>
          ) : isInvalidField(templateState, 'name') ? (
            <FieldError>{tTemplates('nameInvalid')}</FieldError>
          ) : (
            <SettingsError state={templateState} />
          )
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {templateState?.ok ? tTemplates('savedAs', { name: templateState.data.name }) : ''}
          </p>
        )}
      </div>
    </form>
  )
}
