import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@/components/page-skeletons'

/** A test's results while they load: the table skeleton. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton label={t('loading')} variant="table" />
}
