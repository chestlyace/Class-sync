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
