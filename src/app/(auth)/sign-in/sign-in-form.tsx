'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { GoogleButton, OrDivider } from '@/components/google-button'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import { needsFullNavigation } from '@/lib/oauth-resume'

/**
 * `next`: a same-site path (already checked with safeNextPath) to open after signing in.
 * `supportEmail`: the address a suspended account is told to contact (none: no contact line).
 * `google`: offer "Continue with Google". `googleError`: the message key of a Google sign-in that
 * came back failed (googleErrorKey of the page's `error` parameter).
 */
export function SignInForm({
  next = null,
  supportEmail,
  google = false,
  googleError = null,
}: {
  next?: string | null
  supportEmail?: string
  google?: boolean
  googleError?: string | null
}) {
  const t = useTranslations('auth.signIn')
  const tGoogle = useTranslations('auth.google')
  const tRoot = useTranslations()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [googleMessage, setGoogleMessage] = useState<string | null>(() => (googleError ? messageFor(googleError) : null))
  const [googlePending, setGooglePending] = useState(false)

  /** The translated message for a key; a suspended account also gets the contact line. */
  function messageFor(key: string): string {
    const message = tRoot(key)
    return key === 'auth.errors.accountSuspended' && supportEmail
      ? `${message} ${tRoot('auth.errors.accountSuspendedContact', { email: supportEmail })}`
      : message
  }

  async function continueWithGoogle() {
    setGooglePending(true)
    setGoogleMessage(null)
    setError(null)
    try {
      // No account is created from here (the server refuses implicit sign-up): an unknown Google
      // account comes back with `error=signup_disabled`, keeping `next`.
      const { error: authError } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: next ?? '/',
        errorCallbackURL: next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in',
      })
      if (authError) {
        setGoogleMessage(messageFor(authErrorKey(authError.code, authError.status)))
        setGooglePending(false)
      }
      // Otherwise the browser is on its way to Google: keep the button disabled.
    } catch {
      setGoogleMessage(tRoot('common.genericError'))
      setGooglePending(false)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const { data, error: authError } = await authClient.signIn.email({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        // An unverified account gets a fresh verification email: its link comes back here too.
        ...(next ? { callbackURL: next } : {}),
      })
      if (authError) {
        // The signed authorization query expired (about 10 minutes): restart it, which brings
        // the user back here with a fresh one.
        if ((authError as { error?: unknown }).error === 'invalid_signature' && next && needsFullNavigation(next)) {
          window.location.assign(next)
          return
        }
        setError(messageFor(authErrorKey(authError.code, authError.status)))
        return
      }
      // An assistant's authorization in progress: the server answers with where it continues
      // (the consent page, or the assistant itself when already allowed).
      if (data?.redirect && data.url) {
        window.location.assign(data.url)
        return
      }
      if (next && needsFullNavigation(next)) {
        window.location.assign(next)
        return
      }
      router.push(next ?? '/')
      router.refresh()
    } catch {
      setError(tRoot('common.genericError'))
    } finally {
      setPending(false)
    }
  }

  const emailForm = (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </Field>
        <FieldError>{error}</FieldError>
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending} className="mt-1 h-13 text-base">

        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
  if (!google) return emailForm

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <GoogleButton
          onClick={continueWithGoogle}
          pending={googlePending}
          label={tGoogle('continue')}
          pendingLabel={tGoogle('redirecting')}
        />
        {googleMessage && (
          <p role="alert" className="text-sm text-destructive">
            {googleMessage}
          </p>
        )}
      </div>
      <OrDivider label={tGoogle('or')} />
      {emailForm}
    </div>
  )
}
