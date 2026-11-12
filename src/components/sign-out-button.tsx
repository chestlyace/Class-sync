'use client'

import { LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { unsubscribePushAction } from '@/app/actions/push'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { turnOffPush } from '@/lib/push-client'

const PUSH_OFF_TIMEOUT_MS = 2500

export function SignOutButton() {
  const t = useTranslations('nav')
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      // Signing out on purpose takes this device off the account's notifications (while still
      // signed in). Never blocks signing out: errors are ignored and a slow network gets
      // PUSH_OFF_TIMEOUT_MS (a device left behind is removed on the next send that fails).
      try {
        await Promise.race([
          turnOffPush(unsubscribePushAction),
          new Promise((resolve) => setTimeout(resolve, PUSH_OFF_TIMEOUT_MS)),
        ])
      } catch {
        // Ignored, see above.
      }
      await authClient.signOut()
      router.push('/sign-in')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      onClick={signOut}
      disabled={pending}
      aria-label={t('signOut')}
      title={t('signOut')}
    >
      <LogOut aria-hidden="true" />
    </Button>
  )
}
