'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import { passwordsMatch } from '@/lib/password-match'

/**
 * Sets a new password with the token from the email link. The page checked the link first: `email`
 * is the account's address, or null when the link is unknown, used or expired. On success every
 * session is revoked server-side, so the browser is sent to sign-in with the new password.
 *
 * The token stays in the address bar: a reload, or a phone reopening the tab, must still find it.
 * The page sends no referrer, Sentry scrubs the token, and the token dies once used.
 */
export function ResetPasswordForm({ token, email, next = null }: { token: string | null; email: string | null; next?: string | null }) {
  const t = useTranslations('auth.resetPassword')
  const tRoot = useTranslations()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Set when the link dies after the page opened (used in another tab, or expired meanwhile).
  const [expired, setExpired] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

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
        if (key === 'auth.errors.invalidToken') setExpired(true)
        else setError(tRoot(key))
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

  const linkWorks = token !== null && email !== null && !expired

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('title')}</h1>
        {linkWorks ? <p className="text-sm text-muted-foreground wrap-anywhere">{t('forAccount', { email })}</p> : null}
      </div>
      {!linkWorks ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm text-destructive">
            {t('invalidLink')}
          </p>
          <Link
            href={next ? `/forgot-password?next=${encodeURIComponent(next)}` : '/forgot-password'}
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            {t('newLink')}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {/* Password managers save the new password under this account. */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="newPassword">{t('newPassword')}</FieldLabel>
              <PasswordInput
                id="newPassword"
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
              <FieldDescription>{t('passwordHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmPassword">{t('confirmPassword')}</FieldLabel>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
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
