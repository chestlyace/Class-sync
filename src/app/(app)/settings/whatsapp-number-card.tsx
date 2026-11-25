'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { verifyWhatsAppCode } from '@/app/actions/phone-verification'
import { PhoneInput } from '@/components/phone-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatWait } from '@/lib/format-wait'
import { maskPhone, toE164 } from '@/lib/phone'
import { CODE_RESEND_SECONDS, requestPhoneCode } from '@/lib/phone-code'
import { removePhoneNumberAction } from './actions'

const CODE_LENGTH = 6

/**
 * Settings → WhatsApp number: the number that proves the account (sign in, verify, reset a password),
 * with Add / Change (send a code, type it here) and Remove. `canChange` is false while WhatsApp codes
 * are off: the number can still be seen and removed. `phone` is the account's own number (E.164).
 */
export function WhatsAppNumberCard({
  phone,
  verified,
  emailVerified,
  canChange,
}: {
  phone: string | null
  verified: boolean
  emailVerified: boolean
  canChange: boolean
}) {
  const t = useTranslations('settings.whatsappNumber')
  const tAuth = useTranslations('auth.whatsapp')
  const tRoot = useTranslations()
  const router = useRouter()
  const id = useId()
  // 'view': the number and its buttons. 'number': asking for a number. 'code': a code was sent to `target`.
  const [step, setStep] = useState<'view' | 'number' | 'code'>('view')
  const [target, setTarget] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<'send' | 'verify' | 'resend' | 'remove' | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  function reset() {
    setStep('view')
    setTarget(null)
    setCode('')
    setError(null)
    setPending(null)
    setSecondsLeft(0)
  }

  function startEditing() {
    reset()
    setNotice(null)
    setStep('number')
  }

  async function sendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = String(new FormData(event.currentTarget).get('phone') ?? '')
    const e164 = toE164(raw)
    if (!e164) {
      setError(tAuth('errors.invalidNumber'))
      return
    }
    if (verified && e164 === phone) {
      setError(t('sameNumber'))
      return
    }
    setPending('send')
    setError(null)
    const result = await requestPhoneCode(raw)
    if (result.ok) {
      setTarget(result.phone)
      setCode('')
      setSecondsLeft(CODE_RESEND_SECONDS)
      setStep('code')
    } else {
      setError(tRoot(result.messageKey))
    }
    setPending(null)
  }

  async function sendAgain() {
    if (!target) return
    setPending('resend')
    setError(null)
    setNotice(null)
    const result = await requestPhoneCode(target)
    if (result.ok) {
      setSecondsLeft(CODE_RESEND_SECONDS)
      setCode('')
      setNotice(tAuth('resent'))
    } else {
      setError(tRoot(result.messageKey))
      if (result.retryAfter !== null && result.retryAfter <= CODE_RESEND_SECONDS) setSecondsLeft(result.retryAfter)
    }
    setPending(null)
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target) return
    if (code.length !== CODE_LENGTH) {
      setError(tAuth('errors.INVALID_OTP'))
      return
    }
    setPending('verify')
    setError(null)
    setNotice(null)
    try {
      // `alerts: false`: this card only changes the sign-in number; class alerts have their own card.
      const outcome = await verifyWhatsAppCode({ phone: target, code, alerts: false })
      if (outcome.status === 'error') {
        setError(tAuth(`errors.${outcome.code}`))
        setPending(null)
        return
      }
      reset()
      setNotice(t('saved'))
      router.refresh()
    } catch {
      setError(tRoot('common.genericError'))
      setPending(null)
    }
  }

  async function remove() {
    setPending('remove')
    setError(null)
    setNotice(null)
    try {
      const result = await removePhoneNumberAction()
      if (!result.ok) {
        setError(result.code === 'CONFLICT' ? t('removeNeedsEmail') : tRoot(`errors.${result.code}`))
      } else {
        setNotice(t('removed'))
        router.refresh()
      }
    } catch {
      setError(tRoot('common.genericError'))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {phone ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[15px] font-medium">{maskPhone(phone)}</span>
          {verified ? <Badge variant="outline">{t('verified')}</Badge> : <Badge variant="outline">{t('notVerified')}</Badge>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      )}
      {!emailVerified && <p className="text-sm text-muted-foreground">{t('emailNotVerified')}</p>}

      {step === 'view' && (
        <div className="flex flex-wrap items-center gap-2">
          {canChange && (
            <Button type="button" variant="outline" onClick={startEditing} disabled={pending !== null}>
              {phone ? t('change') : t('add')}
            </Button>
          )}
          {phone && (
            <Button type="button" variant="outline" onClick={remove} pending={pending === 'remove'} disabled={pending !== null}>
              {pending === 'remove' ? t('removing') : t('remove')}
            </Button>
          )}
        </div>
      )}

      {step === 'number' && (
        <form onSubmit={sendCode} className="flex max-w-sm flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor={`${id}-phone`}>{tAuth('phone')}</FieldLabel>
            <PhoneInput
              id={`${id}-phone`}
              name="phone"
              aria-describedby={`${id}-hint`}
              aria-invalid={error ? true : undefined}
              maxLength={24}
              autoFocus
              required
            />
            <FieldDescription id={`${id}-hint`}>{tAuth('phoneHint')}</FieldDescription>
            <FieldError>{error}</FieldError>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" pending={pending === 'send'}>
              {pending === 'send' ? tAuth('sending') : tAuth('sendCode')}
            </Button>
            <Button type="button" variant="ghost" onClick={reset} disabled={pending !== null}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      {step === 'code' && target && (
        <div className="flex max-w-sm flex-col gap-4">
          <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
            <Field>
              <FieldLabel htmlFor={`${id}-code`}>{tAuth('codeLabel')}</FieldLabel>
              <FieldDescription>
                {tAuth('codeDescription')} <span className="font-mono text-foreground">{maskPhone(target)}</span>
              </FieldDescription>
              <Input
                id={`${id}-code`}
                name="code"
                value={code}
                // Paste and phone autofill bring spaces or dashes: keep the digits only.
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={CODE_LENGTH + 6}
                aria-invalid={error ? true : undefined}
                className="h-11 text-center font-mono text-xl tracking-[0.4em] md:text-xl"
                autoFocus
                required
              />
              <FieldError>{error}</FieldError>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" pending={pending === 'verify'}>
                {pending === 'verify' ? tAuth('verifying') : tAuth('verify')}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={pending !== null}>
                {t('cancel')}
              </Button>
            </div>
          </form>
          <Button
            type="button"
            variant="outline"
            pending={pending === 'resend'}
            disabled={secondsLeft > 0 || pending !== null}
            onClick={sendAgain}
          >
            {secondsLeft > 0 ? tAuth('resendIn', { time: formatWait(secondsLeft) }) : tAuth('resend')}
          </Button>
        </div>
      )}

      {step === 'view' && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {notice}
      </p>
    </div>
  )
}
