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

/** What a press led to. `message` is a key from the root of messages/*.json. */
export type ClassroomPress =
  | { kind: 'refreshed' }
  | { kind: 'toGoogle' }
  | { kind: 'failed'; result: ActionResult<unknown> }
  | { kind: 'message'; key: string }

/**
 * One press of "Create the classroom": `ready` refreshes the page; `needsGoogle` sends the browser to Google for the
 * Meet permission, coming back (success or error) with `?classroom=google`. Just back from Google and still without
 * the permission (the lecturer left the Meet boxes unticked), it explains instead of going round again, unless
 * `againToGoogle` says the lecturer has read that and pressed once more.
 */
export async function pressClassroomButton(
  courseId: string,
  page: { pathname: string; search: URLSearchParams; refresh: () => void },
  options: { againToGoogle?: boolean } = {},
): Promise<ClassroomPress> {
  let result: Awaited<ReturnType<typeof createClassroomAction>>
  try {
    result = await createClassroomAction(courseId)
  } catch {
    // An outage on Google's side is thrown by the action, not returned.
    return { kind: 'message', key: 'schedule.online.createFailed' }
  }
  if (!result.ok) return { kind: 'failed', result }
  if (result.data.kind === 'ready') {
    page.refresh()
    return { kind: 'refreshed' }
  }
  const justBack = page.search.get('classroom') === 'google' && !page.search.get('error')
  if (justBack && !options.againToGoogle) return { kind: 'message', key: 'schedule.online.googleStillMissing' }
  try {
    const back = pageUrl(page.pathname, page.search, { classroom: 'google' })
    const { error } = await authClient.linkSocial({
      provider: 'google',
      scopes: [...MEET_SCOPES],
      additionalParams: { ...MEET_LINK_PARAMS },
      callbackURL: back,
      // Better Auth adds `&error=…`; `classroom=google` marks it as this round trip's.
      errorCallbackURL: back,
    })
    if (error) return { kind: 'message', key: authErrorKey(error.code, error.status) }
    return { kind: 'toGoogle' }
  } catch {
    return { kind: 'message', key: 'common.genericError' }
  }
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
  // Only an error from this round trip (marked by `classroom=google`) is Google's.
  const googleError = returning ? googleErrorKey(search.get('error')) : null
  const [pending, startTransition] = useTransition()
  // Set once the browser is on its way to Google: the button stays busy until the page goes.
  const [leaving, setLeaving] = useState(false)
  const [failed, setFailed] = useState<ActionResult<unknown> | null>(null)
  const [message, setMessage] = useState<string | null>(() => (googleError ? tRoot(googleError) : null))
  // Set after "Google didn't give the permission": the next press goes to Google again.
  const [againToGoogle, setAgainToGoogle] = useState(false)

  function create() {
    setFailed(null)
    setMessage(null)
    startTransition(async () => {
      const outcome = await pressClassroomButton(
        courseId,
        { pathname, search, refresh: () => router.refresh() },
        { againToGoogle },
      )
      if (outcome.kind === 'failed') setFailed(outcome.result)
      else if (outcome.kind === 'message') {
        setMessage(tRoot(outcome.key))
        if (outcome.key === 'schedule.online.googleStillMissing') setAgainToGoogle(true)
      }
      else if (outcome.kind === 'toGoogle') setLeaving(true)
    })
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" pending={pending || leaving} onClick={create}>
        <Video aria-hidden="true" data-icon="inline-start" />
        {returning && !googleError && !againToGoogle ? t('finishClassroom') : t('createClassroom')}
      </Button>
      {!googleGranted && !returning && <p className="text-sm text-muted-foreground">{t('googleNeeded')}</p>}
      {message && <FieldError>{message}</FieldError>}
      <ActionError state={failed} />
    </div>
  )
}
