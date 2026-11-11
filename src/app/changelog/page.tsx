import { getLocale, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { SiteFooter } from '@/components/site-footer'
import { SiteNav } from '@/components/site-nav'
import { getSessionUser } from '@/server/auth/session'

export async function generateMetadata() {
  const t = await getTranslations('changelog')
  return { title: t('title'), description: t('description') }
}

/** What shipped, newest first: message keys under `changelog.items.<key>`. Add new releases at the top. */
const releases = [
  { date: '2026-11-11', items: ['google', 'legal', 'matricule'] },
  { date: '2026-11-09', items: ['receipts', 'links', 'checklist'] },
  { date: '2026-11-08', items: ['assistant', 'notes', 'tests', 'ca'] },
  { date: '2026-11-07', items: ['launch'] },
] as const

/** The public changelog ("What's new"), linked from the footer. Open to everyone, signed in or not. */
export default async function ChangelogPage() {
  const t = await getTranslations('changelog')
  const locale = await getLocale()
  // Best effort, like the 404 page: a session lookup failure must not hide the page.
  const user = await getSessionUser().catch(() => null)
  const format = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' })

  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-4 pt-8 pb-20 sm:pt-12">
        <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
        <ol className="flex flex-col">
          {releases.map(({ date, items }) => (
            <li key={date} className="grid gap-4 border-t py-8 sm:grid-cols-[10rem_1fr] sm:gap-8">
              <time
                dateTime={date}
                className="font-mono text-xs font-medium tracking-[0.1em] text-muted-foreground uppercase sm:pt-1"
              >
                {format.format(new Date(`${date}T12:00:00Z`))}
              </time>
              <ul className="flex flex-col gap-6">
                {items.map((key) => (
                  <li key={key} className="flex flex-col gap-1.5">
                    <h2 className="text-lg font-semibold">{t(`items.${key}.title`)}</h2>
                    <p className="leading-relaxed text-subtle">{t(`items.${key}.body`)}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </main>
      <SiteFooter />
    </>
  )
}
