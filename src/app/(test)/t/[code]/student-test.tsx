import { Lock } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { ErrorState } from '@/components/error-state'
import { Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'
import { resolveTestLink } from '@/server/tests/attempt'
import { loadPage } from '@/app/(app)/load-page'

/** A calm screen with nothing of the test, for anyone the link is not for. */
export async function NotYourCourse() {
  const t = await getTranslations('tests.student')
  return (
    <Panel role="alert" className="flex flex-col items-start gap-4">
      <Lock aria-hidden="true" className="size-6 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t('notYourCourse.title')}</h1>
        <p className="text-muted-foreground">{t('notYourCourse.body')}</p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
        {t('backToDashboard')}
      </Link>
    </Panel>
  )
}

/**
 * Resolves `/t/<code>/<sub>` for a student: signed out → sign in and come back; the owner → the
 * test's lecturer page; anyone off the roster → `screen` with the not-your-course panel.
 */
export async function resolveStudentTest(
  code: string,
  sub: 'review' | 'practice',
): Promise<{ ok: true; testId: string } | { ok: false; screen: ReactNode }> {
  const path = `/t/${encodeURIComponent(code)}/${sub}`
  const user = await getSessionUser()
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(path)}`)
  const link = await loadPage((ctx) => resolveTestLink(ctx, code))
  if (!link.ok) return { ok: false, screen: link.code === 'FORBIDDEN' ? <NotYourCourse /> : <ErrorState code={link.code} /> }
  if (link.data.role === 'owner') {
    redirect(`/courses/${encodeURIComponent(link.data.courseId)}/tests/${encodeURIComponent(link.data.testId)}`)
  }
  return { ok: true, testId: link.data.testId }
}
