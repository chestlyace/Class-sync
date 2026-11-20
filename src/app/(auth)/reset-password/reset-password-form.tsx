'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import { passwordsMatch } from '@/lib/password-match'

/**
 * Sets a new password with the token from the email link. On success every session is revoked
 * server-side, so the browser is sent to sign-in with the new password rather than left signed in.
 */
export function ResetPasswordForm({ token, next = null }: { token: string | null; next?: string | null }) {
  const t = useTranslations('auth.resetPassword')
  const tForgot = useTranslations('auth.forgotPassword')
  const tRoot = useTranslations()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // The token is already in the component state; drop it from the address bar, browser history
  // and error reports. Keeping the server-rendered prop means no useSearchParams/Suspense needed.
  useEffect(() => {
    if (token) window.history.replaceState(null, '', window.location.pathname)
  }, [token])

  // Password managers can leave one field untouched or fill it with a different value. Comparing
  // the controlled values and showing a live match state makes that visible before submission.
  const fieldsMatch = newPassword.length > 0 && passwordsMatch(newPassword, confirmPassword)
  const showMatch = fieldsMatch && newPassword.length >= 8

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    if (!passwordsMatch(newPassword, confirmPassword)) {
      setError(t('mismatch'))
      return
    }
    setPending(true)
    setError(null)
    try {
      const { error: authError } = await authClient.resetPassword({ newPassword, token })
      if (authError) {
        const key = authErrorKey(authError.code, authError.status)
        // A spent or expired link gets the actionable message; anything else is a translated error.
        setError(key === 'auth.errors.invalidToken' ? t('invalidLink') : tRoot(key))
        return
      }
      router.push(next ? `/sign-in?passwordReset=1&next=${encodeURIComponent(next)}` : '/sign-in?passwordReset=1')
      router.refresh()
    } catch {
      setError(tRoot('common.genericError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      {!token ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-destructive">
            {t('invalidLink')}
          </p>
          <Link
            href={next ? `/forgot-password?next=${encodeURIComponent(next)}` : '/forgot-password'}
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            {tForgot('title')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="newPassword">{t('newPassword')}</FieldLabel>
              <PasswordInput
                id="newPassword"
                name="newPassword"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                minLength={8}
                required
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value)
                  setError(null)
                }}
              />
              <FieldDescription>{t('passwordHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmPassword">{t('confirmPassword')}</FieldLabel>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value)
                  setError(null)
                }}
              />
              {showMatch && (
                <p role="status" className="text-sm text-ok">
                  {t('match')}
                </p>
              )}
            </Field>
            <FieldError>{error}</FieldError>
          </FieldGroup>
          <p className="text-sm text-muted-foreground">{t('revokeNote')}</p>
          <Button type="submit" size="lg" pending={pending} className="mt-1 h-13 text-base">
            {pending ? t('submitting') : t('submit')}
          </Button>
        </form>
      )}
    </>
  )
}
