import { getTranslations } from 'next-intl/server'
import { PageSkeleton } from '@/components/page-skeletons'

/** Taking a test while it loads: the panels skeleton, inside the narrow test layout. */
export default async function Loading() {
  const t = await getTranslations('common')
  return <PageSkeleton label={t('loading')} variant="panels" />
}
