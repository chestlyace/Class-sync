'use client'

import { Check, MapPin } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ErrorCodeMessage } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import type { CheckInRefusal } from '@/server/attendance/check-in'
import type { Position } from '@/server/attendance/geo'
import { checkInAction } from './actions'

const MAX_CODE_LENGTH = 20

const REFUSALS: Record<CheckInRefusal, true> = {
  closed: true,
  too_many_attempts: true,
  wrong_code: true,
  location_required: true,
  location_imprecise: true,
  off_campus: true,
}

function isRefusal(value: unknown): value is CheckInRefusal {
  return typeof value === 'string' && Object.hasOwn(REFUSALS, value)
}

type Phase = 'idle' | 'locating' | 'sending'

type Outcome = { kind: 'done'; already: boolean } | { kind: 'error'; message: React.ReactNode }

/** One position fix; null when the browser has no geolocation, the prompt is denied or it times out. */
function locate(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

/** Code entry for one open check-in; asks for the position only when the session requires it. */
export function CheckInForm({ windowId, requireOnCampus }: { windowId: string; requireOnCampus: boolean }) {
  const t = useTranslations('attendance.student')
  const tRoot = useTranslations()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const inputId = `check-in-code-${windowId}`
  const hintId = `${inputId}-hint`

  function failureMessage(result: Extract<ActionResult<unknown>, { ok: false }>): React.ReactNode {
    if (result.code === 'VALIDATION') {
      const reason = result.details?.reason
      if (isRefusal(reason)) return t(`refusal.${reason}`)
      const fields = result.details?.fields
      if (Array.isArray(fields) && fields.includes('code')) return t('codeRequired')
    }
    if (result.code === 'FORBIDDEN') return t('forbidden')
    if (result.code === 'EMAIL_UNVERIFIED') return t('emailUnverified')
    return <ErrorCodeMessage code={result.code} />
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phase !== 'idle') return
    if (!code.trim()) {
      setOutcome({ kind: 'error', message: t('codeRequired') })
      return
    }
    setOutcome(null)
    try {
      let position: Position | null = null
      if (requireOnCampus) {
        setPhase('locating')
        position = await locate()
      }
      setPhase('sending')
      const result = await checkInAction(windowId, code, position)
      if (result.ok) {
        setOutcome({ kind: 'done', already: result.data.result === 'already_checked_in' })
        router.refresh() // the card turns into "Checked in"
      } else {
        setOutcome({ kind: 'error', message: failureMessage(result) })
      }
    } catch {
      setOutcome({ kind: 'error', message: tRoot('common.genericError') })
    } finally {
      setPhase('idle')
    }
  }

  if (outcome?.kind === 'done') {
    return (
      <p role="status" className="flex items-center gap-2 font-medium">
        <Check aria-hidden="true" className="size-5 text-primary" />
        {outcome.already ? t('alreadyCheckedIn') : t('checkedIn')}
      </p>
    )
  }

  const invalid = outcome?.kind === 'error' || undefined
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FieldGroup>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={inputId}>{t('codeLabel')}</FieldLabel>
          <Input
            id={inputId}
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={MAX_CODE_LENGTH}
            aria-describedby={hintId}
            aria-invalid={invalid}
            className="max-w-56 font-mono text-lg tracking-[0.2em] uppercase"
          />
          <FieldDescription id={hintId}>{t('codeHint')}</FieldDescription>
        </Field>
        {requireOnCampus && (
          <p className="flex gap-2 text-sm text-muted-foreground">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('locationExplain')}
          </p>
        )}
        {/* FieldError is role="alert"; it is cleared on each submit, so a repeated refusal is announced again. */}
        {outcome?.kind === 'error' && <FieldError>{outcome.message}</FieldError>}
      </FieldGroup>
      <Button type="submit" size="lg" disabled={phase !== 'idle'} className="self-start">
        {phase === 'locating' ? t('locating') : phase === 'sending' ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
