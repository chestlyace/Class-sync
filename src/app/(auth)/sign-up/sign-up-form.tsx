'use client'

import { GraduationCap, School } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { GoogleButton, OrDivider } from '@/components/google-button'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import { needsFullNavigation } from '@/lib/oauth-resume'
import type { Locale } from '@/i18n/locale'

const roles = [
  { value: 'student', icon: GraduationCap },
  { value: 'lecturer', icon: School },
] as const

/**
 * `next`: a same-site path (already checked with safeNextPath) to open once signed in.
 * `google`: offer "Continue with Google" right under the role. `googleError`: the message key of a
 * Google sign-up that came back failed (googleErrorKey of the page's `error` parameter).
 */
export function SignUpForm({
  defaultLocale,
  next = null,
  google = false,
  googleError = null,
}: {
  defaultLocale: Locale
  next?: string | null
  google?: boolean
  googleError?: string | null
}) {
  const t = useTranslations('auth.signUp')
  const tGoogle = useTranslations('auth.google')
  const tCommon = useTranslations('common')
  const tRoot = useTranslations()
  const router = useRouter()
  // No default: the role is permanent, so it must be an explicit choice.
  const [role, setRole] = useState<'lecturer' | 'student' | null>(null)
  const [roleError, setRoleError] = useState(false)
  const [locale, setLocale] = useState<Locale>(defaultLocale)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [googleMessage, setGoogleMessage] = useState<string | null>(() => (googleError ? tRoot(googleError) : null))
  const [googlePending, setGooglePending] = useState(false)

  /**
   * Sign up with Google: the role (and language) chosen above ride along in the OAuth state and
   * are checked on the server like an email sign-up. Name, email and verification come from
   * Google. A Google account that already has a Clasync account is simply signed in.
   */
  async function continueWithGoogle() {
    if (role === null) {
      setRoleError(true)
      return
    }
    setGooglePending(true)
    setGoogleMessage(null)
    setError(null)
    try {
      const { error: authError } = await authClient.signIn.social({
        provider: 'google',
        requestSignUp: true,
        additionalData: { role, locale },
        callbackURL: next ?? '/',
        errorCallbackURL: next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up',
      })
      if (authError) {
        setGoogleMessage(tRoot(authErrorKey(authError.code, authError.status)))
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
    if (role === null) {
      setRoleError(true)
      return
    }
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    setPending(true)
    setError(null)
    try {
      const { data, error: authError } = await authClient.signUp.email({
        name: String(form.get('name') ?? ''),
        email,
        password: String(form.get('password') ?? ''),
        role,
        locale,
        // Where the verification link lands (it then asks to sign in, keeping `next`).
        ...(next ? { callbackURL: next } : {}),
      })
      if (authError) {
        setError(tRoot(authErrorKey(authError.code, authError.status)))
        return
      }
      // No session token means the account must be verified by email first.
      if (data?.token && next && needsFullNavigation(next)) {
        // e.g. resuming an assistant's authorization: a route handler, not a page.
        window.location.assign(next)
      } else if (data?.token) {
        router.push(next ?? '/')
        router.refresh()
      } else {
        const query = new URLSearchParams({ email })
        if (next) query.set('next', next)
        router.push(`/verify-email?${query}`)
      }
    } catch {
      setError(tRoot('common.genericError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FieldGroup>
        <FieldSet aria-describedby="role-hint" aria-invalid={roleError || undefined}>
          <FieldLegend variant="label">{t('role')}</FieldLegend>
          <div className="grid grid-cols-2 gap-2.5">
            {roles.map(({ value, icon: Icon }) => (
              <label
                key={value}
                className="flex cursor-pointer flex-col gap-2 rounded-2xl border p-3.5 has-[:checked]:border-2 has-[:checked]:border-foreground has-[:checked]:p-[13px] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
              >
                <span className="flex items-center justify-between">
                  <Icon aria-hidden="true" className="size-[22px]" />
                  <input
                    type="radio"
                    name="role"
                    value={value}
                    checked={role === value}
                    onChange={() => {
                      setRole(value)
                      setRoleError(false)
                    }}
                    className="size-4 accent-foreground"
                  />
                </span>
                <span className="text-sm font-semibold">{value === 'lecturer' ? t('roleLecturer') : t('roleStudent')}</span>
              </label>
            ))}
          </div>
          <FieldDescription id="role-hint">{t('roleHint')}</FieldDescription>
          {roleError && <FieldError>{t('roleRequired')}</FieldError>}
        </FieldSet>
        {google && (
          <>
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
            <OrDivider label={tGoogle('orEmail')} />
          </>
        )}
        <Field>
          <FieldLabel htmlFor="name">{t('name')}</FieldLabel>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">{t('email')}</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">{t('password')}</FieldLabel>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
          <FieldDescription>{t('passwordHint')}</FieldDescription>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">{t('language')}</FieldLegend>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-[#ebebef] p-1">
            {(['en', 'fr'] as const).map((value) => (
              <label
                key={value}
                className="flex h-10 cursor-pointer items-center justify-center rounded-full text-sm font-medium text-[#48484a] has-[:checked]:bg-background has-[:checked]:font-semibold has-[:checked]:text-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
              >
                <input
                  type="radio"
                  name="locale"
                  value={value}
                  checked={locale === value}
                  onChange={() => setLocale(value)}
                  className="sr-only"
                />
                {value === 'en' ? tCommon('english') : tCommon('french')}
              </label>
            ))}
          </div>
        </FieldSet>
        <FieldError>{error}</FieldError>
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending} className="mt-1 h-13 text-base">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
