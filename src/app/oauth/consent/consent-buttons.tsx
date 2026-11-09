'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'

/**
 * Allow / Deny. The auth client sends this page's signed query along; the server answers with
 * where to go next (the assistant's callback, with a code or with access_denied).
 */
export function ConsentButtons({ canAllow }: { canAllow: boolean }) {
  const t = useTranslations('oauthConsent')
  const tCommon = useTranslations('common')
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function answer(accept: boolean) {
    setPending(accept ? 'allow' : 'deny')
    setError(null)
    try {
      const { data, error: consentError } = await authClient.oauth2.consent({ accept })
      if (consentError || !data?.url) {
        setError(consentError?.status === 400 ? t('expired') : tCommon('genericError'))
        setPending(null)
        return
      }
      window.location.assign(data.url)
    } catch {
      setError(tCommon('genericError'))
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" disabled={pending !== null} onClick={() => answer(false)}>
          {pending === 'deny' ? t('denying') : t('deny')}
        </Button>
        {canAllow && (
          <Button type="button" size="lg" disabled={pending !== null} onClick={() => answer(true)}>
            {pending === 'allow' ? t('allowing') : t('allow')}
          </Button>
        )}
      </div>
      <FieldError>{error}</FieldError>
    </div>
  )
}
