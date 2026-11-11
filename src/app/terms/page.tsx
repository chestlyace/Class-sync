import { getLocale, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { SiteFooter } from '@/components/site-footer'
import { SiteNav } from '@/components/site-nav'
import { supportEmail } from '@/lib/contact'
import { getSessionUser } from '@/server/auth/session'

/** Change along with the text: shown as "Last updated". */
const UPDATED = new Date('2026-11-11T12:00:00Z')

export async function generateMetadata() {
  const t = await getTranslations('terms')
  return { title: t('title'), description: t('description') }
}

/** The terms' sections, in order: message keys under `terms.<key>`. */
const sections = [
  { key: 'accounts', items: ['real', 'yours', 'lecturers'] },
  { key: 'use', items: ['checkIn', 'others', 'tests', 'content', 'service'] },
  { key: 'content', items: ['own', 'license', 'marks'] },
  { key: 'ai', items: ['suggestions', 'assistants'] },
  { key: 'service', items: ['body'] },
  { key: 'ending', items: ['leave', 'suspend'] },
  { key: 'liability', items: ['body'] },
  { key: 'changes', items: ['body'] },
] as const

/**
 * The public terms of use, linked from the footer and sign-up. Open to everyone, signed in or not.
 * Laid out like the privacy policy.
 */
export default async function TermsPage() {
  const t = await getTranslations('terms')
  const locale = await getLocale()
  // Best effort, like the 404 page: a session lookup failure must not hide the terms.
  const user = await getSessionUser().catch(() => null)
  const date = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(UPDATED)
  const address = supportEmail()
  const linkClass = 'font-medium text-primary underline-offset-4 hover:underline'
  const rich = {
    address,
    email: (chunks: React.ReactNode) => (
      <a href={`mailto:${address}`} className={linkClass}>
        {chunks}
      </a>
    ),
    privacy: (chunks: React.ReactNode) => (
      <Link href="/privacy" className={linkClass}>
        {chunks}
      </Link>
    ),
  }

  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pt-8 pb-20 sm:pt-12">
        <PageHeader eyebrow={t('updated', { date })} title={t('title')} description={t('description')} />
        <p className="leading-relaxed">{t.rich('intro', rich)}</p>
        {sections.map((section) => (
          <section key={section.key} aria-labelledby={`terms-${section.key}`} className="flex flex-col gap-4">
            <SectionHeading id={`terms-${section.key}`}>{t(`${section.key}.title`)}</SectionHeading>
            <Panel className="flex flex-col gap-3 leading-relaxed">
              {section.items.length === 1 ? (
                <p>{t(`${section.key}.${section.items[0]}`)}</p>
              ) : (
                <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted-foreground">
                  {section.items.map((item) => (
                    <li key={item}>{t.rich(`${section.key}.${item}`, rich)}</li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  )
}
