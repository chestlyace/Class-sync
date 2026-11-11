import { getLocale, getTranslations } from 'next-intl/server'
import { PageHeader, Panel, SectionHeading } from '@/components/page-header'
import { SiteNav } from '@/components/site-nav'
import { getSessionUser } from '@/server/auth/session'

/** Where privacy questions and deletion requests go (forwards to the owner). */
const PRIVACY_CONTACT = 'chestlyace@clasync.online'

/** Change along with the text: shown as "Last updated". */
const UPDATED = new Date('2026-11-11T12:00:00Z')

export async function generateMetadata() {
  const t = await getTranslations('privacy')
  return { title: t('title'), description: t('description') }
}

/** The policy's sections, in order: message keys under `privacy.<key>`. */
const sections = [
  { key: 'collect', items: ['account', 'google', 'classes', 'tests', 'location', 'signIns'] },
  { key: 'access', items: ['lecturers', 'you', 'admins', 'sold'] },
  { key: 'services', intro: true, items: ['vercel', 'database', 'email', 'errors', 'ai', 'google'] },
  { key: 'assistants', items: ['body'] },
  { key: 'cookies', items: ['body'] },
  { key: 'rights', items: ['edit', 'google', 'delete', 'keep'] },
  { key: 'changes', items: ['body'] },
] as const

/**
 * The public privacy policy, linked from the landing footer, sign-up and Google's consent screen.
 * Open to everyone, signed in or not.
 */
export default async function PrivacyPage() {
  const t = await getTranslations('privacy')
  const locale = await getLocale()
  // Best effort, like the 404 page: a session lookup failure must not hide the policy.
  const user = await getSessionUser().catch(() => null)
  const date = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(UPDATED)
  const rich = {
    address: PRIVACY_CONTACT,
    email: (chunks: React.ReactNode) => (
      <a href={`mailto:${PRIVACY_CONTACT}`} className="font-medium text-primary underline-offset-4 hover:underline">
        {chunks}
      </a>
    ),
  }

  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pt-8 pb-20 sm:pt-12">
        <PageHeader eyebrow={t('updated', { date })} title={t('title')} description={t('description')} />
        <p className="leading-relaxed">{t.rich('intro', rich)}</p>
        {sections.map((section) => (
          <section key={section.key} aria-labelledby={`privacy-${section.key}`} className="flex flex-col gap-4">
            <SectionHeading id={`privacy-${section.key}`}>{t(`${section.key}.title`)}</SectionHeading>
            <Panel className="flex flex-col gap-3 leading-relaxed">
              {'intro' in section && <p>{t(`${section.key}.intro`)}</p>}
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
    </>
  )
}
