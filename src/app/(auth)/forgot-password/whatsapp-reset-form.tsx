'use client'

import { MessageCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { PhoneInput } from '@/components/phone-input'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import { formatWait } from '@/lib/format-wait'
import { needsFullNavigation } from '@/lib/oauth-resume'
import { maskPhone, toE164 } from '@/lib/phone'
import { CODE_RESEND_SECONDS, codeRequestError } from '@/lib/phone-code'
import { resetPasswordByWhatsAppAction } from './actions'

const CODE_LENGTH = 6

/**
 * Reset by WhatsApp code, in two steps on one page: the number, then the 6-digit code with the new password.
 * The page answers the same for every number ("if this number belongs to an account"): it never says whether
 * one does. "Send again" opens once the server's wait between two codes has passed. A right code changes the
 * password and signs this browser in, then goes on to `next` (or the dashboard).
 */
export function WhatsAppResetForm({
  next = null,
  signInHref,
  onUseEmail,
}: {
  next?: string | null
  signInHref: string
  onUseEmail: () => void
}) {
  const t = useTranslations('auth.forgotPassword')
  const tWa = useTranslations('auth.whatsapp')
  const tReset = useTranslations('auth.resetPassword')
  const tRoot = useTranslations()
  const router = useRouter()
  const id = useId()
  const [phone, setPhone] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [resending, setResending] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  /** Asks for a code; true when the request went through (whether or not the number belongs to an account). */
  async function requestCode(e164: string): Promise<boolean> {
    try {
      const { error: authError } = await authClient.phoneNumber.requestPasswordReset({ phoneNumber: e164 })
      if (authError) {
        const failure = codeRequestError(authError as { code?: string; status?: number; retryAfter?: unknown })
        setError(tRoot(failure.messageKey))
        if (failure.retryAfter !== null && failure.retryAfter <= CODE_RESEND_SECONDS) setSecondsLeft(failure.retryAfter)
        return false
      }
      setSecondsLeft(CODE_RESEND_SECONDS)
      return true
    } catch {
      setError(tRoot('common.genericError'))
      return false
    }
  }

  async function onSendCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const e164 = toE164(String(new FormData(event.currentTarget).get('phone') ?? ''))
    if (!e164) {
      setError(tWa('errors.invalidNumber'))
      return
    }
    setPending(true)
    setError(null)
    if (await requestCode(e164)) setPhone(e164)
    setPending(false)
  }

  async function sendAgain() {
    if (phone === null) return
    setResending(true)
    setError(null)
    setNotice(null)
    if (await requestCode(phone)) {
      setCode('')
      setNotice(tWa('resent'))
    }
    setResending(false)
  }

  async function onReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phone === null) return
    if (code.length !== CODE_LENGTH) {
      setError(t('whatsappWrongCode'))
      return
    }
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await resetPasswordByWhatsAppAction(phone, code, newPassword)
      if (outcome.status === 'error') {
        setError(outcome.code === 'INVALID_OTP' ? t('whatsappWrongCode') : tRoot(authErrorKey(outcome.code, outcome.httpStatus)))
        setPending(false)
        return
      }
      if (outcome.status === 'reset') {
        // Changed, but this browser could not be signed in: sign-in explains why.
        router.push(next ? `/sign-in?passwordReset=1&next=${encodeURIComponent(next)}` : '/sign-in?passwordReset=1')
        router.refresh()
        return
      }
      // Signed in: keep the button busy while the next page loads.
      if (next && needsFullNavigation(next)) {
        window.location.assign(next)
        return
      }
      router.push(next ?? '/dashboard')
      router.refresh()
    } catch {
      setError(tRoot('common.genericError'))
      setPending(false)
    }
  }

  if (phone === null) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('whatsappDescription')}</p>
        </div>
        <form onSubmit={onSendCode} className="flex flex-col gap-4" noValidate>
          <Field>
            <FieldLabel htmlFor={`${id}-phone`}>{tWa('phone')}</FieldLabel>
            <PhoneInput
              id={`${id}-phone`}
              name="phone"
              aria-describedby={`${id}-hint`}
              aria-invalid={error ? true : undefined}
              maxLength={24}
              required
            />
            <FieldDescription id={`${id}-hint`}>{tWa('phoneHint')}</FieldDescription>
            <FieldError>{error}</FieldError>
          </Field>
          <Button type="submit" size="lg" pending={pending} className="h-13 text-base">
            {pending ? tWa('sending') : tWa('sendCode')}
          </Button>
        </form>
        <div className="flex flex-col items-start gap-1">
          <Button type="button" variant="ghost" size="lg" onClick={onUseEmail}>
            {t('emailInstead')}
          </Button>
          <Link href={signInHref} className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline">
            {t('backToSignIn')}
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{tWa('codeTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('whatsappSentDescription')} <span className="font-mono text-foreground">{maskPhone(phone)}</span>
        </p>
      </div>
      <form onSubmit={onReset} className="flex flex-col gap-4" noValidate>
        {/* Password managers save the new password under this number. */}
        <input type="tel" name="username" autoComplete="username" value={phone} readOnly hidden />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-code`}>{tWa('codeLabel')}</FieldLabel>
            <Input
              id={`${id}-code`}
              name="code"
              value={code}
              // Paste and phone autofill bring spaces or dashes: keep the digits only.
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                setError(null)
              }}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH + 6}
              aria-invalid={error ? true : undefined}
              className="h-13 text-center font-mono text-2xl tracking-[0.4em] md:text-2xl"
              autoFocus
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-password`}>{tReset('newPassword')}</FieldLabel>
            <PasswordInput
              id={`${id}-password`}
              name="newPassword"
              autoComplete="new-password"
              minLength={8}
              required
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value)
                setError(null)
              }}
            />
            <FieldDescription>{tReset('passwordHint')}</FieldDescription>
          </Field>
          <FieldError>{error}</FieldError>
        </FieldGroup>
        <p className="text-sm text-muted-foreground">{tReset('revokeNote')}</p>
        <Button type="submit" size="lg" pending={pending} className="h-13 text-base">
          {pending ? tReset('submitting') : tReset('submit')}
        </Button>
      </form>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" size="lg" pending={resending} disabled={secondsLeft > 0} onClick={sendAgain}>
          <MessageCircle aria-hidden="true" />
          {secondsLeft > 0 ? tWa('resendIn', { time: formatWait(secondsLeft) }) : tWa('resend')}
        </Button>
        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {notice}
        </p>
        {/* Said once when the wait is over, instead of announcing every second of it. */}
        <p role="status" className="sr-only">
          {secondsLeft === 0 ? tWa('canResend') : ''}
        </p>
      </div>
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setPhone(null)
            setCode('')
            setNewPassword('')
            setError(null)
            setNotice(null)
            setSecondsLeft(0)
          }}
          className="h-auto min-h-11 px-0"
        >
          {tWa('otherNumber')}
        </Button>
        <Button type="button" variant="link" onClick={onUseEmail} className="h-auto min-h-11 px-0">
          {t('emailInstead')}
        </Button>
      </div>
    </>
  )
}
