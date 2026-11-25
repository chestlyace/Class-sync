'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import { formatWait } from '@/lib/format-wait'
import { RESET_RESEND_SECONDS } from '@/lib/password-reset'

/**
 * Asks the server to email a reset link. The confirmation never reveals whether the address exists.
 * "Send again" opens once the server's per-address wait has passed, with the time left shown, so
 * pressing it always sends.
 */
export function ForgotPasswordForm({ next = null, googleEnabled = false }: { next?: string | null; googleEnabled?: boolean }) {
  const t = useTranslations('auth.forgotPassword')
  const tRoot = useTranslations()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [sentAgain, setSentAgain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  /** Requests a link; true when the request went through (whether or not the account exists). */
  async function request(email: string): Promise<boolean> {
    setPending(true)
    setError(null)
    try {
      const { error: authError } = await authClient.requestPasswordReset({
        email,
        // Better Auth passes this to sendResetPassword; the server re-validates it before
        // putting it on the emailed link.
        ...(next ? { redirectTo: next } : {}),
      })
      if (authError) {
        setError(tRoot(authErrorKey(authError.code, authError.status)))
        return false
      }
      setSecondsLeft(RESET_RESEND_SECONDS)
      return true
    } catch {
      setError(tRoot('common.genericError'))
      return false
    } finally {
      setPending(false)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') ?? '')
    // The endpoint answers the same way for an unknown address: never disclose who has an account.
    if (await request(email)) setSentTo(email)
  }

  async function sendAgain() {
    if (sentTo !== null && (await request(sentTo))) setSentAgain(true)
  }

  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'

  if (sentTo !== null) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('sentTitle')}</h1>
          <p className="text-sm text-muted-foreground wrap-anywhere">{t('sentDescription', { email: sentTo })}</p>
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
          {googleEnabled ? <p className="text-sm text-muted-foreground">{t('google')}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" size="lg" pending={pending} disabled={secondsLeft > 0} onClick={sendAgain}>
            {secondsLeft > 0 ? t('resendIn', { time: formatWait(secondsLeft) }) : t('resend')}
          </Button>
          {sentAgain && !error ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('resent')}
            </p>
          ) : null}
          <FieldError>{error}</FieldError>
        </div>
        <Link href={signInHref} className="self-start text-sm text-primary underline-offset-4 hover:underline">
          {t('backToSignIn')}
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
            <Input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
          </Field>
          <FieldError>{error}</FieldError>
        </FieldGroup>
        <Button type="submit" size="lg" pending={pending} className="mt-1 h-13 text-base">
          {pending ? t('submitting') : t('submit')}
        </Button>
      </form>
      <Link href={signInHref} className="self-start text-sm text-primary underline-offset-4 hover:underline">
        {t('backToSignIn')}
      </Link>
    </>
  )
}
