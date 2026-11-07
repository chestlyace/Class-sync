'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import { isLocale, type Locale } from '@/i18n/locale'

export function SignUpForm({ defaultLocale }: { defaultLocale: Locale }) {
  const t = useTranslations('auth.signUp')
  const tCommon = useTranslations('common')
  const tRoot = useTranslations()
  const router = useRouter()
  const [role, setRole] = useState<'lecturer' | 'student'>('student')
  const [locale, setLocale] = useState<Locale>(defaultLocale)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
      })
      if (authError) {
        setError(tRoot(authErrorKey(authError.code)))
        return
      }
      // No session token means the account must be verified by email first.
      if (data?.token) {
        router.push('/')
        router.refresh()
      } else {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`)
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
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <FieldDescription>{t('passwordHint')}</FieldDescription>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">{t('role')}</FieldLegend>
          <div className="flex flex-col gap-2">
            {(['lecturer', 'student'] as const).map((value) => (
              <label
                key={value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
              >
                <input
                  type="radio"
                  name="role"
                  value={value}
                  checked={role === value}
                  onChange={() => setRole(value)}
                  className="size-4 accent-primary"
                />
                {value === 'lecturer' ? t('roleLecturer') : t('roleStudent')}
              </label>
            ))}
          </div>
        </FieldSet>
        <Field>
          <FieldLabel htmlFor="language">{t('language')}</FieldLabel>
          <Select value={locale} onValueChange={(v) => isLocale(v) && setLocale(v)}>
            <SelectTrigger id="language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{tCommon('english')}</SelectItem>
              <SelectItem value="fr">{tCommon('french')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <FieldError>{error}</FieldError>
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
