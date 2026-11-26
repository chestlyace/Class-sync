'use client'

import { Video } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ActionError } from '@/components/action-error'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import type { ActionResult } from '@/lib/action-result'
import { authClient } from '@/lib/auth-client'
import { authErrorKey, googleErrorKey } from '@/lib/auth-errors'
import { MEET_LINK_PARAMS, MEET_SCOPES } from '@/lib/google-meet-scopes'
import { createClassroomAction } from '../courses/[courseId]/classroom-actions'

/** The page's own address with `classroom` and Google's error parameters replaced by `extra`. */
function pageUrl(pathname: string, search: URLSearchParams, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(search.toString())
  for (const key of ['classroom', 'error', 'error_description']) params.delete(key)
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/**
 * "Create the classroom" for a course that has none. When Google has not yet allowed Clasync to make Meet rooms,
 * the press goes to Google first and comes back with `?classroom=google`; the button then reads "Finish creating
 * the classroom" and one more press makes it (opening the page never creates anything).
 */
export function ClassroomButton({ courseId, googleGranted }: { courseId: string; googleGranted: boolean }) {
  const t = useTranslations('schedule.online')
  const tRoot = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const returning = search.get('classroom') === 'google'
  const [pending, startTransition] = useTransition()
  // Set once the browser is on its way to Google: the button stays busy until the page goes.
  const [leaving, setLeaving] = useState(false)
  const [failed, setFailed] = useState<ActionResult<unknown> | null>(null)
  const [message, setMessage] = useState<string | null>(() => {
    const key = googleErrorKey(search.get('error'))
    return key ? tRoot(key) : null
  })

  function create() {
    setFailed(null)
    setMessage(null)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createClassroomAction>>
      try {
        result = await createClassroomAction(courseId)
      } catch {
        setMessage(t('createFailed'))
        return
      }
      if (!result.ok) {
        setFailed(result)
        return
      }
      if (result.data.kind === 'ready') {
        router.refresh()
        return
      }
      try {
        const { error } = await authClient.linkSocial({
          provider: 'google',
          scopes: [...MEET_SCOPES],
          additionalParams: { ...MEET_LINK_PARAMS },
          callbackURL: pageUrl(pathname, search, { classroom: 'google' }),
          // Better Auth adds `?error=…` (or `&error=…`) to this address.
          errorCallbackURL: pageUrl(pathname, search),
        })
        if (error) setMessage(tRoot(authErrorKey(error.code, error.status)))
        else setLeaving(true)
      } catch {
        setMessage(tRoot('common.genericError'))
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" pending={pending || leaving} onClick={create}>
        <Video aria-hidden="true" data-icon="inline-start" />
        {returning ? t('finishClassroom') : t('createClassroom')}
      </Button>
      {!googleGranted && !returning && <p className="text-sm text-muted-foreground">{t('googleNeeded')}</p>}
      {message && <FieldError>{message}</FieldError>}
      <ActionError state={failed} />
    </div>
  )
}
