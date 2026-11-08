import { Lock } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ErrorState } from '@/components/error-state'
import { Panel } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'
import { resolveTestLink } from '@/server/tests/attempt'
import { loadPage } from '@/app/(app)/load-page'
import { TestRunner } from './test-runner'

export async function generateMetadata() {
  const t = await getTranslations('tests.student')
  return { title: t('metaTitle') }
}

/**
 * The link a student opens to take a test. Signed out → sign in and come back; the lecturer who
 * owns it → its live page; anyone off the roster → a calm screen with nothing of the test.
 */
export default async function TestPage({ params }: PageProps<'/t/[code]'>) {
  const { code } = await params
  const path = `/t/${encodeURIComponent(code)}`
  const user = await getSessionUser()
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(path)}`)

  const link = await loadPage((ctx) => resolveTestLink(ctx, code))
  if (!link.ok) return link.code === 'FORBIDDEN' ? <NotYourCourse /> : <ErrorState code={link.code} />
  if (link.data.role === 'owner') {
    redirect(`/courses/${encodeURIComponent(link.data.courseId)}/tests/${encodeURIComponent(link.data.testId)}`)
  }
  return <TestRunner userId={user.id} code={code} />
}

async function NotYourCourse() {
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
