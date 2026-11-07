'use client'

import { LocateFixed, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useActionState, useState } from 'react'
import { ActionError, isInvalidField } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { submitWith } from '@/lib/form-submit'
import { createSchoolAction } from './actions'

type Location =
  | { status: 'none' }
  | { status: 'locating' }
  | { status: 'set'; latitude: number; longitude: number }
  | { status: 'failed'; reason: 'denied' | 'unavailable' | 'unsupported' }

const COORD_DIGITS = 6 // ~0.1 m: plenty for a school geofence

export function NewSchoolForm() {
  const t = useTranslations('schools.new')
  const [state, dispatch, pending] = useActionState(createSchoolAction, null)
  const [location, setLocation] = useState<Location>({ status: 'none' })

  function locate() {
    if (!('geolocation' in navigator)) {
      setLocation({ status: 'failed', reason: 'unsupported' })
      return
    }
    setLocation({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setLocation({
          status: 'set',
          latitude: Number(position.coords.latitude.toFixed(COORD_DIGITS)),
          longitude: Number(position.coords.longitude.toFixed(COORD_DIGITS)),
        }),
      (error) =>
        setLocation({
          status: 'failed',
          reason: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  const existingSchoolId =
    state && !state.ok && state.code === 'CONFLICT' && typeof state.details?.existingSchoolId === 'string'
      ? state.details.existingSchoolId
      : null

  return (
    <form onSubmit={submitWith(dispatch)} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={isInvalidField(state, 'name') || undefined}>
          <FieldLabel htmlFor="school-name">{t('name')}</FieldLabel>
          <Input
            id="school-name"
            name="name"
            autoComplete="organization"
            maxLength={120}
            aria-invalid={isInvalidField(state, 'name') || undefined}
          />
        </Field>
        <Field data-invalid={isInvalidField(state, 'town') || undefined}>
          <FieldLabel htmlFor="school-town">{t('town')}</FieldLabel>
          <Input
            id="school-town"
            name="town"
            autoComplete="address-level2"
            maxLength={120}
            aria-invalid={isInvalidField(state, 'town') || undefined}
          />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">{t('location')}</FieldLegend>
          <FieldDescription>{t('locationHint')}</FieldDescription>
          {/* Both coordinates or neither: they are only ever set together. */}
          <input type="hidden" name="latitude" value={location.status === 'set' ? location.latitude : ''} />
          <input type="hidden" name="longitude" value={location.status === 'set' ? location.longitude : ''} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={locate}
              disabled={location.status === 'locating'}
            >
              <LocateFixed aria-hidden="true" data-icon="inline-start" />
              {location.status === 'locating' ? t('locating') : t('useLocation')}
            </Button>
            {location.status === 'set' && (
              <Button type="button" variant="ghost" onClick={() => setLocation({ status: 'none' })}>
                <X aria-hidden="true" data-icon="inline-start" />
                {t('clearLocation')}
              </Button>
            )}
          </div>
          <div aria-live="polite">
            {location.status === 'set' && (
              <p className="font-mono text-sm">
                {t('locationSet', { lat: location.latitude, lng: location.longitude })}
              </p>
            )}
            {location.status === 'failed' && (
              <FieldError>
                {location.reason === 'denied'
                  ? t('locationDenied')
                  : location.reason === 'unsupported'
                    ? t('locationUnsupported')
                    : t('locationUnavailable')}
              </FieldError>
            )}
          </div>
        </FieldSet>
        <ActionError
          state={state}
          overrides={
            existingSchoolId
              ? {
                  CONFLICT: (
                    <span className="flex flex-col items-start gap-2">
                      {t('conflict')}
                      <Link
                        href={`/classes/new?schoolId=${encodeURIComponent(existingSchoolId)}`}
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        {t('useExisting')}
                      </Link>
                    </span>
                  ),
                }
              : undefined
          }
        />
      </FieldGroup>
      <Button type="submit" size="lg" disabled={pending} className="self-start">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
