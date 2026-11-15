import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { ErrorState } from '@/components/error-state'
import { getTestPracticePaper } from '@/server/tests/review'
import { loadPage } from '@/app/(app)/load-page'
import { PracticeRunner } from '@/app/(app)/courses/practice-runner'
import { resolveStudentTest } from '../student-test'

export async function generateMetadata() {
  const t = await getTranslations('tests.review')
  return { title: t('practise') }
}

/** A released test practised again: never timed, never counted. Not open → back to the test. */
export default async function TestPracticePage({ params }: PageProps<'/t/[code]/practice'>) {
  const { code } = await params
  const resolved = await resolveStudentTest(code, 'practice')
  if (!resolved.ok) return resolved.screen
  const { testId } = resolved
  const paper = await loadPage((ctx) => getTestPracticePaper(ctx, testId))
  if (!paper.ok) {
    if (paper.code === 'CONFLICT') redirect(`/t/${encodeURIComponent(code)}`)
    return <ErrorState code={paper.code} />
  }
  const { questions, outcomes, title } = paper.data
  return <PracticeRunner source={{ kind: 'test', testId, code, title }} questions={questions} outcomes={outcomes} />
}
