import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@/components/page-skeletons'

/** The notes list, and the pages under it, while they load: the list skeleton. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton label={t('loading')} variant="list" />
}
