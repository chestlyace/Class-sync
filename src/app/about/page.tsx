import { LockKeyhole, Smartphone, UserCheck } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Eyebrow, Panel, SectionHeading } from '@/components/page-header'
import { SiteFooter } from '@/components/site-footer'
import { SiteNav } from '@/components/site-nav'
import { buttonVariants } from '@/components/ui/button'
import { HELLO_EMAIL, supportEmail } from '@/lib/contact'
import { getSessionUser } from '@/server/auth/session'

export async function generateMetadata() {
  const t = await getTranslations('about')
  return { title: t('metaTitle'), description: t('description') }
}

const principles = [
  { key: 'lecturers', Icon: UserCheck },
  { key: 'privacy', Icon: LockKeyhole },
  { key: 'phone', Icon: Smartphone },
] as const

/** The public About page: why Clasync exists, what it holds to, and how to reach it. */
export default async function AboutPage() {
  const t = await getTranslations('about')
  // Best effort, like the 404 page: a session lookup failure must not hide the page.
  const user = await getSessionUser().catch(() => null)
  const contacts = [
    { label: t('contact.hello'), address: HELLO_EMAIL },
    { label: t('contact.support'), address: supportEmail() },
  ]

  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-4 pt-12 pb-24 sm:gap-24 sm:pt-20">
        <header className="flex flex-col gap-6">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="max-w-[16ch] font-display text-6xl leading-[0.9] text-balance sm:text-8xl">{t('title')}</h1>
        </header>

        <section aria-labelledby="about-story" className="grid gap-6 sm:grid-cols-[1fr_2fr] sm:gap-12">
          <h2 id="about-story" className="font-mono text-[13px] font-semibold tracking-[0.1em] uppercase">
            {t('story.title')}
          </h2>
          <div className="flex max-w-[62ch] flex-col gap-5 text-lg leading-relaxed text-subtle">
            <p>{t('story.p1')}</p>
            <p>{t('story.p2')}</p>
          </div>
        </section>

        <section aria-labelledby="about-principles" className="flex flex-col gap-6">
          <SectionHeading id="about-principles">{t('principles.title')}</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-3">
            {principles.map(({ key, Icon }) => (
              <Panel key={key} className="flex flex-col gap-3">
                <Icon aria-hidden="true" className="size-5 text-primary" strokeWidth={2} />
                <h3 className="text-lg font-semibold">{t(`principles.${key}.title`)}</h3>
                <p className="leading-relaxed text-subtle">{t(`principles.${key}.body`)}</p>
              </Panel>
            ))}
          </div>
        </section>

        <section aria-labelledby="about-contact" className="flex flex-col gap-6">
          <SectionHeading id="about-contact">{t('contact.title')}</SectionHeading>
          <Panel className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-4">
              <p className="max-w-[48ch] leading-relaxed">{t('contact.body')}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                {contacts.map(({ label, address }) => (
                  <div key={address} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>
                      <a href={`mailto:${address}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {address}
                      </a>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            {!user && (
              <Link href="/sign-up" className={buttonVariants({ variant: 'contrast', className: 'self-start sm:self-auto' })}>
                {t('contact.cta')}
              </Link>
            )}
          </Panel>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
