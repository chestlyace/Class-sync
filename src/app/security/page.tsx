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
  const t = await getTranslations('security')
  return { title: t('title'), description: t('description') }
}

/** The page's sections, in order: message keys under `security.<key>`. */
const sections = [
  { key: 'accounts', items: ['passwords', 'verify', 'limits', 'suspend'] },
  { key: 'access', items: ['lecturers', 'students', 'admins'] },
  { key: 'data', items: ['https', 'files', 'errors', 'sold'] },
  { key: 'ai', items: ['suggest', 'names', 'assistants'] },
  { key: 'integrity', items: ['codes', 'timer', 'leave'] },
  { key: 'report', items: ['body'] },
] as const

/**
 * The public security page, linked from the footer and the page for schools. Open to everyone,
 * signed in or not. Laid out like the privacy policy; keep its claims true to the code.
 */
export default async function SecurityPage() {
  const t = await getTranslations('security')
  const locale = await getLocale()
  // Best effort, like the 404 page: a session lookup failure must not hide the page.
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
          <section key={section.key} aria-labelledby={`security-${section.key}`} className="flex flex-col gap-4">
            <SectionHeading id={`security-${section.key}`}>{t(`${section.key}.title`)}</SectionHeading>
            <Panel className="flex flex-col gap-3 leading-relaxed">
              {section.items.length === 1 ? (
                <p>{t.rich(`${section.key}.${section.items[0]}`, rich)}</p>
              ) : (
                <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted-foreground">
                  {section.items.map((item) => (
                    <li key={item}>{t(`${section.key}.${item}`)}</li>
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
