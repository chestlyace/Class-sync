'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/password-input'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'

/** `next`: a same-site path (already checked with safeNextPath) to open after signing in. */
export function SignInForm({ next = null }: { next?: string | null }) {
  const t = useTranslations('auth.signIn')
  const tRoot = useTranslations()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const { error: authError } = await authClient.signIn.email({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        // An unverified account gets a fresh verification email: its link comes back here too.
        ...(next ? { callbackURL: next } : {}),
      })
      if (authError) {
        setError(tRoot(authErrorKey(authError.code, authError.status)))
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

  return (
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
}
