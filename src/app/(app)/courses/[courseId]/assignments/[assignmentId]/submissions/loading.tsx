import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@/components/page-skeletons'

/** A submission while it loads: the panels skeleton. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton label={t('loading')} variant="panels" />
}
