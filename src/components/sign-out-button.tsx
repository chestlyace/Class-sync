'use client'

import { LogOut } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function SignOutButton() {
  const t = useTranslations('nav')
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
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
