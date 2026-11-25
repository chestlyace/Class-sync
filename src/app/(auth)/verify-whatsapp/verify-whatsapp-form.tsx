'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { WhatsAppNumberForm } from '@/components/whatsapp-number-form'
import { verifyWhatsAppCode } from '@/app/actions/phone-verification'
import { authClient } from '@/lib/auth-client'
import { needsFullNavigation } from '@/lib/oauth-resume'
import { formatWait } from '@/lib/format-wait'
import { maskPhone } from '@/lib/phone'
import { CODE_RESEND_SECONDS, codeRequestError, requestPhoneCode, verifyWhatsAppHref } from '@/lib/phone-code'

const CODE_LENGTH = 6

/**
 * Type the 6-digit code sent on WhatsApp. `phone` is the number the code went to (E.164), or null when the
 * page has none yet: then it asks for the number first. "Use email instead" sends the usual verification
 * link to `email`.
 */
export function VerifyWhatsAppForm({
  phone,
  alerts,
  next,
  email,
  startError = null,
}: {
  phone: string | null
  alerts: boolean
  next: string | null
  email: string
  /** The error code of a code request that failed just before (at sign-up): shown on the number step. */
  startError?: string | null
}) {
  const t = useTranslations('auth.whatsapp')
  const tRoot = useTranslations()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [resending, setResending] = useState(false)
  const [emailPending, setEmailPending] = useState(false)
  // The code was sent just before this page opened: a new one is allowed after the server's wait.
  const [secondsLeft, setSecondsLeft] = useState(CODE_RESEND_SECONDS)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const otherNumberHref = verifyWhatsAppHref(null, { alerts, next })

  async function useEmailInstead() {
    setEmailPending(true)
    setError(null)
    try {
      const { error: authError } = await authClient.sendVerificationEmail({ email, callbackURL: next ?? '/dashboard' })
      if (authError) {
        setError(t('errors.emailFailed'))
        return
      }
      const query = new URLSearchParams({ email })
      if (next) query.set('next', next)
      router.push(`/verify-email?${query}`)
    } catch {
      setError(t('errors.emailFailed'))
    } finally {
      setEmailPending(false)
    }
  }

  const useEmail = (
    <Button type="button" variant="ghost" size="lg" pending={emailPending} onClick={useEmailInstead}>
      {t('useEmail')}
    </Button>
  )

  if (phone === null) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('numberTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('numberDescription')}</p>
        </div>
        <WhatsAppNumberForm
          next={next}
          alerts={alerts}
          initialError={startError ? tRoot(codeRequestError({ code: startError }).messageKey) : null}
        />
        <div className="flex flex-col gap-2">
          {useEmail}
          <FieldError>{error}</FieldError>
        </div>
      </>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (phone === null) return
    if (code.length !== CODE_LENGTH) {
      setError(t('errors.INVALID_OTP'))
      return
    }
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      const outcome = await verifyWhatsAppCode({ phone, code, alerts })
      if (outcome.status === 'error') {
        setError(t(`errors.${outcome.code}`))
        setPending(false)
        return
      }
      // Verified: keep the button busy while the next page opens.
      if (next && needsFullNavigation(next)) {
        window.location.assign(next)
      } else {
        router.push(next ?? '/dashboard')
        router.refresh()
      }
    } catch {
      setError(tRoot('common.genericError'))
      setPending(false)
    }
  }

  async function sendAgain() {
    if (phone === null) return
    setResending(true)
    setError(null)
    setNotice(null)
    const result = await requestPhoneCode(phone)
    if (result.ok) {
      setSecondsLeft(CODE_RESEND_SECONDS)
      setCode('')
      setNotice(t('resent'))
    } else {
      setError(tRoot(result.messageKey))
      // The server's own wait, when it is a short one: the button counts it down.
      if (result.retryAfter !== null && result.retryAfter <= CODE_RESEND_SECONDS) setSecondsLeft(result.retryAfter)
    }
    setResending(false)
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('codeTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('codeDescription')} <span className="font-mono text-foreground">{maskPhone(phone)}</span>
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field>
          <FieldLabel htmlFor="code">{t('codeLabel')}</FieldLabel>
          <Input
            id="code"
            name="code"
            value={code}
            // Paste and phone autofill bring spaces or dashes: keep the digits only.
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH + 6}
            aria-invalid={error ? true : undefined}
            className="h-13 text-center font-mono text-2xl tracking-[0.4em] md:text-2xl"
            autoFocus
            required
          />
          <FieldError>{error}</FieldError>
        </Field>
        <Button type="submit" size="lg" pending={pending} className="h-13 text-base">
          {pending ? t('verifying') : t('verify')}
        </Button>
      </form>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" size="lg" pending={resending} disabled={secondsLeft > 0} onClick={sendAgain}>
          {secondsLeft > 0 ? t('resendIn', { time: formatWait(secondsLeft) }) : t('resend')}
        </Button>
        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {notice}
        </p>
        {/* Said once when the wait is over, instead of announcing every second of it. */}
        <p role="status" className="sr-only">
          {secondsLeft === 0 ? t('canResend') : ''}
        </p>
      </div>
      <div className="flex flex-col items-start gap-1">
        <Link
          href={otherNumberHref}
          className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('otherNumber')}
        </Link>
        <Button type="button" variant="link" pending={emailPending} onClick={useEmailInstead} className="h-auto min-h-11 px-0">
          {t('useEmail')}
        </Button>
      </div>
    </>
  )
}
