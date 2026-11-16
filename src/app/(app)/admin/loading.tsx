import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@/components/page-skeletons'

/** Admin pages while they load: the panels skeleton, under the admin tabs. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton label={t('loading')} variant="panels" />
}
