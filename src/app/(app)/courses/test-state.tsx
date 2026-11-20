import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { TestState } from '@/server/tests/phase'

const VARIANT: Record<TestState, 'outline' | 'default' | 'secondary'> = {
  not_started: 'outline',
  running: 'default',
  ended: 'secondary',
  released: 'secondary',
}

/** A test's state as a text pill: Not started / Running / Ended / Results out. */
export function TestStatePill({ state }: { state: TestState }) {
  const t = useTranslations('tests.lecturer.state')
  return <Badge variant={VARIANT[state]}>{t(state)}</Badge>
}

/** Who a catch-up is for: "5 who missed it" or "3 students picked". */
export function CatchUpAudience({
  catchUpFor,
  pickedCount,
  missedCount,
}: {
  catchUpFor: 'missed' | 'picked'
  pickedCount: number | null
  missedCount: number | null
}) {
  const t = useTranslations('tests.catchUp')
  if (catchUpFor === 'missed') return missedCount === null ? t('forMissed') : t('missedCount', { count: missedCount })
  return t('pickedCount', { count: pickedCount ?? 0 })
}
