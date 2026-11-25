'use client'

import { MailWarning } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { WhatsAppInstead } from '@/components/whatsapp-number-form'
import { authClient } from '@/lib/auth-client'

type State = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * Shown instead of create/join actions while the account is unverified. `whatsapp` adds "Verify with WhatsApp
 * instead" (WhatsApp codes are on and today's budget has room).
 */
export function VerifyBanner({ email, whatsapp = false }: { email: string; whatsapp?: boolean }) {
  const t = useTranslations('verifyBanner')
  const [state, setState] = useState<State>('idle')

  async function resend() {
    setState('sending')
    try {
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL: '/dashboard' })
      setState(error ? 'failed' : 'sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-3xl border bg-muted p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <MailWarning aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{t('title')}</p>
            <p className="text-sm text-muted-foreground">{t('body', { email })}</p>
            <p role="status" className="text-sm">
              {state === 'sent' ? t('sent') : state === 'failed' ? t('failed') : ''}
            </p>
          </div>
        </div>
        <Button type="button" onClick={resend} disabled={state === 'sending'}>
          {state === 'sending' ? t('sending') : t('resend')}
        </Button>
      </div>
      {whatsapp ? <WhatsAppInstead /> : null}
    </div>
  )
}
