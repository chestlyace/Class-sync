'use client'

import { LocateFixed } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { setLocale } from '@/app/actions/locale'
import { ActionError } from '@/components/action-error'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action-result'
import { authClient } from '@/lib/auth-client'
import { authErrorKey } from '@/lib/auth-errors'
import type { Locale } from '@/i18n/locale'
import { setSchoolLocationAction } from './actions'

/** Edit the display name in place. */
export function NameForm({ initialName }: { initialName: string }) {
  const t = useTranslations('settings.account')
  const tRoot = useTranslations()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) {
      setError(t('nameRequired'))
      return
    }
    setPending(true)
    setError(null)
    try {
      const { error: authError } = await authClient.updateUser({ name })
      if (authError) {
        setError(tRoot(authErrorKey(authError.code, authError.status)))
        return
      }
      setEditing(false)
      router.refresh()
    } catch {
      setError(tRoot('common.genericError'))
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <Button type="button" variant="outline" onClick={() => setEditing(true)}>
        {t('editName')}
      </Button>
    )
  }
  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="settings-name">{t('name')}</FieldLabel>
        <Input id="settings-name" name="name" defaultValue={initialName} autoComplete="name" maxLength={120} autoFocus />
        <FieldError>{error}</FieldError>
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          {tRoot('common.cancel')}
        </Button>
      </div>
    </form>
  )
}

/** English / Français. Saved on the profile, so emails follow it too. */
export function LanguageSwitch({ locale }: { locale: Locale }) {
  const t = useTranslations('settings.preferences')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <FieldSet>
      <FieldLegend variant="label">{t('language')}</FieldLegend>
      <FieldDescription>{t('languageHint')}</FieldDescription>
      <div className="grid max-w-xs grid-cols-2 gap-1 rounded-full bg-[#ebebef] p-1" aria-busy={pending || undefined}>
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
              disabled={pending}
              onChange={() =>
                startTransition(async () => {
                  await setLocale(value)
                  router.refresh()
                })
              }
              className="sr-only"
            />
            {value === 'en' ? tCommon('english') : tCommon('french')}
          </label>
        ))}
      </div>
    </FieldSet>
  )
}

/** For a school with no campus location yet: set it from where the lecturer stands now. */
export function SchoolLocationButton({ schoolId }: { schoolId: string }) {
  const t = useTranslations('settings.schools')
  const [state, setState] = useState<ActionResult<null> | null>(null)
  const [geoError, setGeoError] = useState<'denied' | 'unavailable' | null>(null)
  const [pending, setPending] = useState(false)

  function locate() {
    if (!('geolocation' in navigator)) {
      setGeoError('unavailable')
      return
    }
    setPending(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          setState(
            await setSchoolLocationAction(schoolId, {
              latitude: coords.latitude,
              longitude: coords.longitude,
              accuracy: coords.accuracy,
            }),
          )
        } finally {
          setPending(false)
        }
      },
      (error) => {
        setGeoError(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable')
        setPending(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" size="sm" onClick={locate} disabled={pending}>
        <LocateFixed aria-hidden="true" data-icon="inline-start" />
        {pending ? t('locating') : t('useMyLocation')}
      </Button>
      <p className="text-[13px] text-muted-foreground">{t('locationHint')}</p>
      {geoError && (
        <p role="alert" className="text-sm text-destructive">
          {geoError === 'denied' ? t('locationDenied') : t('locationUnavailable')}
        </p>
      )}
      <ActionError state={state} />
    </div>
  )
}

/** Change password: the current one, then the new one. Other devices are signed out. */
export function ChangePasswordForm() {
  const t = useTranslations('settings.password')
  const tRoot = useTranslations()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    setError(null)
    setDone(false)
    try {
      const { error: authError } = await authClient.changePassword({
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
        revokeOtherSessions: true,
      })
      if (authError) {
        setError(tRoot(authErrorKey(authError.code, authError.status)))
        return
      }
      form.reset()
      setDone(true)
    } catch {
      setError(tRoot('common.genericError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="current-password">{t('current')}</FieldLabel>
          <PasswordInput id="current-password" name="currentPassword" autoComplete="current-password" required />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-password">{t('new')}</FieldLabel>
          <PasswordInput id="new-password" name="newPassword" autoComplete="new-password" minLength={8} required />
          <FieldDescription>{t('hint')}</FieldDescription>
        </Field>
        <FieldError>{error}</FieldError>
        {done && (
          <p role="status" className="text-sm text-[#047857]">
            {t('changed')}
          </p>
        )}
      </FieldGroup>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t('saving') : t('submit')}
      </Button>
    </form>
  )
}
