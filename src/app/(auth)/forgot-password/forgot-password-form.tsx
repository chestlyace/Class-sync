'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'

/** Asks the server to email a reset link. The confirmation never reveals whether the address exists. */
export function ForgotPasswordForm({ next = null }: { next?: string | null }) {
  const t = useTranslations('auth.forgotPassword')
  const tRoot = useTranslations()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
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
        return
      }
      // The endpoint answers the same way for an unknown address: never disclose who has an account.
      setSentTo(email)
    } catch {
      setError(tRoot('common.genericError'))
    } finally {
      setPending(false)
    }
  }

  if (sentTo !== null) {
    return (
      <>
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-5xl leading-[0.95] tracking-[0.01em]">{t('sentTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('sentDescription', { email: sentTo })}</p>
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
        </div>
        <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
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
      <Link
        href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}
        className="self-start text-sm text-[#48484a] underline-offset-4 hover:underline"
      >
        {t('backToSignIn')}
      </Link>
    </>
  )
}
