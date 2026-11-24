'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { unsubscribeAction } from './actions'

/**
 * The button that turns announcements off. Nothing happens until it is pressed. After it (or when
 * the account was already off) the page says so, that account emails carry on, and links to Settings.
 */
export function UnsubscribeForm({ token, alreadyOff }: { token: string; alreadyOff: boolean }) {
  const t = useTranslations('unsubscribe')
  const [done, setDone] = useState(alreadyOff)
  const [unknown, setUnknown] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFailed(false)
    try {
      const outcome = await unsubscribeAction(token)
      if (outcome === 'unsubscribed') setDone(true)
      else setUnknown(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  if (unknown) {
    return (
      <>
        <p className="font-semibold">{t('unknown.title')}</p>
        <p className="text-muted-foreground">{t('unknown.body')}</p>
        <SettingsLink />
      </>
    )
  }

  if (done) {
    return (
      <>
        <p role="status" className="font-semibold">
          {t('done.title')}
        </p>
        <p className="text-muted-foreground">{t('done.body')}</p>
        <SettingsLink />
      </>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <p className="text-muted-foreground">{t('question')}</p>
      <div>
        <Button type="submit" pending={pending}>
          {pending ? t('submitting') : t('submit')}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('failed')}
        </p>
      )}
    </form>
  )
}

function SettingsLink() {
  const t = useTranslations('unsubscribe')
  return (
    <div>
      <Link href="/settings" className={buttonVariants({ variant: 'outline' })}>
        {t('settingsLink')}
      </Link>
    </div>
  )
}
