import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { getSessionUser } from '@/server/auth/session'
import { isAdmin } from '@/server/core/admin'

type Section = 'overview' | 'people' | 'usage' | 'ai' | 'health' | 'audit'

/**
 * "<Section> · Admin" for an admin. Metadata is resolved apart from the layout's guard, so it
 * checks again: anyone else gets the not-found page's own title, never the admin one.
 */
export async function adminMetadata(section: Section): Promise<Metadata> {
  const user = await getSessionUser()
  if (!user || !isAdmin(user)) notFound()
  const t = await getTranslations('admin')
  const titles: Record<Section, string> = {
    overview: t('overview.title'),
    people: t('people.title'),
    usage: t('usage.title'),
    ai: t('ai.title'),
    health: t('health.title'),
    audit: t('audit.title'),
  }
  return { title: `${titles[section]} · ${t('title')}` }
}
