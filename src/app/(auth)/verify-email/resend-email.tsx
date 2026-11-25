'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

/** "Send again" for a verification email that could not be sent: asks for the link once more and says how it went. */
export function ResendVerificationEmail({ email, next }: { email: string; next: string | null }) {
  const t = useTranslations('auth.verify')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  async function resend() {
    setState('sending')
    try {
      const { error } = await authClient.sendVerificationEmail({ email, ...(next ? { callbackURL: next } : {}) })
      setState(error ? 'failed' : 'sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="lg" pending={state === 'sending'} onClick={resend}>
        {t('sendAgain')}
      </Button>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {state === 'sent' ? t('sentAgain') : ''}
      </p>
      {state === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('notSent')}
        </p>
      ) : null}
    </div>
  )
}
