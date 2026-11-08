'use client'

import { Check, Save } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { submitWith } from '@/lib/form-submit'
import { formatDecimal } from '@/lib/number-format'
import type { CaSettings } from '@/server/performance/rules'
import { updateCaSettingsAction } from './performance-actions'
import {
  parseDecimalInput,
  POINT_FIELDS,
  SETTINGS_FIELDS,
  sumInCents,
  type PointField,
  type SettingsField,
} from './performance-form'

/** VALIDATION reasons of `updateCaSettings`. */
const REASONS = ['sum', 'range', 'decimals', 'tests', 'shape'] as const
type Reason = (typeof REASONS)[number]

const LABELS: Record<PointField, 'attendance' | 'assignments' | 'participation'> = {
  attendancePoints: 'attendance',
  assignmentPoints: 'assignments',
  participationPoints: 'participation',
}

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
  if (reason) return <FieldError>{t(reason, { example: formatDecimal(7.25, locale) })}</FieldError>
  if (SETTINGS_FIELDS.some((f) => isInvalidField(state, f))) return <FieldError>{t('fields')}</FieldError>
  return <ActionError state={state} />
}

/**
 * The course's CA split: total, points per component and the participation target. A live
 * helper adds the parts up (in cents, like the server); Save stays enabled, the server decides.
 * Test points arrive with phase 3 and are always sent as 0.
 */
export function CaSettingsForm({ courseId, initial }: { courseId: string; initial: CaSettings }) {
  const t = useTranslations('performance.lecturer.settings')
  const locale = useLocale()
  const [values, setValues] = useState<Record<SettingsField, string>>(() => ({
    total: String(initial.total),
    attendancePoints: String(initial.attendancePoints),
    assignmentPoints: String(initial.assignmentPoints),
    participationPoints: String(initial.participationPoints),
    participationTarget: String(initial.participationTarget),
  }))
  const [edited, setEdited] = useState(false)
  const [state, dispatch, pending] = useActionState(
    (prev: ActionResult<CaSettings> | null, data: FormData) => {
      setEdited(false)
      return updateCaSettingsAction(courseId, prev, data)
    },
    null,
  )
  const reason = reasonOf(state)
  const invalid = (field: SettingsField) => {
    if (isInvalidField(state, field)) return true
    if (reason === 'sum') return field !== 'participationTarget' || undefined
    return undefined
  }

  const sum = sumInCents(POINT_FIELDS.map((f) => parseDecimalInput(values[f]))) / 100
  const total = parseDecimalInput(values.total)
  const matches = Number.isFinite(total) && Math.round(total * 100) === Math.round(sum * 100)

  function set(field: SettingsField, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    setEdited(true)
  }

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-6">
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
          <div className="grid gap-5 sm:grid-cols-3">
            {POINT_FIELDS.map((field) => (
              <Field key={field} data-invalid={invalid(field)}>
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
                  value={values[field]}
                  onChange={(e) => set(field, e.target.value)}
                  aria-invalid={invalid(field)}
                  className="font-mono"
                />
              </Field>
            ))}
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
      </FieldGroup>

      <SettingsError state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Save aria-hidden="true" data-icon="inline-start" />
          {pending ? t('saving') : t('save')}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {state?.ok && !edited ? t('saved') : ''}
        </p>
      </div>
    </form>
  )
}
