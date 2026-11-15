import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { ErrorState } from '@/components/error-state'
import { getSessionUser } from '@/server/auth/session'
import { resolveTestLink } from '@/server/tests/attempt'
import { getMyTestResult } from '@/server/tests/results'
import { getReviewAccess } from '@/server/tests/review'
import { loadPage } from '@/app/(app)/load-page'
import { ReleasedResult } from './released-result'
import { NotYourCourse } from './student-test'
import { TestRunner } from './test-runner'

export async function generateMetadata() {
  const t = await getTranslations('tests.student')
  return { title: t('metaTitle') }
}

/**
 * The link a student opens to take a test. Signed out → sign in and come back; the lecturer who
 * owns it → its live page; anyone off the roster → a calm screen with nothing of the test. Once
 * results with short answers are released (the release email links here), the student's own
 * result in detail; before that, and for MCQ-only tests, the runner shows where things stand.
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
  const { testId } = link.data
  const [released, access] = await Promise.all([
    loadPage((ctx) => getMyTestResult(ctx, testId)),
    loadPage((ctx) => getReviewAccess(ctx, testId)),
  ])
  const review = access.ok ? access.data : null
  if (released.ok) return <ReleasedResult result={released.data} code={code} review={review} />
  // CONFLICT: not released yet, or MCQ-only (the runner's quick result).
  if (released.code !== 'CONFLICT') return <ErrorState code={released.code} />
  return <TestRunner userId={user.id} code={code} review={review} />
}
