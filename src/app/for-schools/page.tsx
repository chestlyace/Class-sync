import { CalendarCheck, Calculator, Smartphone, Users } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Eyebrow, Panel, SectionHeading } from '@/components/page-header'
import { SiteFooter } from '@/components/site-footer'
import { SiteNav } from '@/components/site-nav'
import { buttonVariants } from '@/components/ui/button'
import { HELLO_EMAIL } from '@/lib/contact'
import { getSessionUser } from '@/server/auth/session'

export async function generateMetadata() {
  const t = await getTranslations('forSchools')
  return { title: t('metaTitle'), description: t('description') }
}

const benefits = [
  { key: 'attendance', Icon: CalendarCheck },
  { key: 'ca', Icon: Calculator },
  { key: 'shared', Icon: Users },
  { key: 'phone', Icon: Smartphone },
] as const

const steps = ['talk', 'setup', 'join'] as const

/** The public page for departments and schools, ending in a "talk to us" email to hello@. */
export default async function ForSchoolsPage() {
  const t = await getTranslations('forSchools')
  // Best effort, like the 404 page: a session lookup failure must not hide the page.
  const user = await getSessionUser().catch(() => null)
  const mailto = `mailto:${HELLO_EMAIL}?subject=${encodeURIComponent(t('contact.subject'))}`

  return (
    <>
      <SiteNav user={user} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-4 pt-12 pb-24 sm:gap-24 sm:pt-20">
        <header className="flex flex-col gap-6">
          <Eyebrow>{t('eyebrow')}</Eyebrow>
          <h1 className="max-w-[16ch] font-display text-6xl leading-[0.9] text-balance sm:text-8xl">{t('title')}</h1>
          <p className="max-w-[62ch] text-lg leading-relaxed text-subtle">{t('lead')}</p>
          <a href={mailto} className={buttonVariants({ variant: 'contrast', size: 'lg', className: 'self-start' })}>
            {t('contact.cta')}
          </a>
        </header>

        <section aria-labelledby="schools-benefits" className="flex flex-col gap-6">
          <SectionHeading id="schools-benefits">{t('benefits.title')}</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-2">
            {benefits.map(({ key, Icon }) => (
              <Panel key={key} className="flex flex-col gap-3">
                <Icon aria-hidden="true" className="size-5 text-primary" strokeWidth={2} />
                <h3 className="text-lg font-semibold">{t(`benefits.${key}.title`)}</h3>
                <p className="leading-relaxed text-subtle">{t(`benefits.${key}.body`)}</p>
              </Panel>
            ))}
          </div>
        </section>

        <section aria-labelledby="schools-steps" className="flex flex-col gap-6">
          <SectionHeading id="schools-steps">{t('steps.title')}</SectionHeading>
          <ol className="grid gap-x-8 gap-y-8 md:grid-cols-3">
            {steps.map((key, i) => (
              <li key={key} className="flex flex-col gap-3 border-t pt-6">
                <span aria-hidden="true" className="font-display text-6xl leading-[0.85] text-primary">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="text-lg font-semibold">{t(`steps.${key}.title`)}</h3>
                <p className="leading-relaxed text-subtle">{t(`steps.${key}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="schools-contact" className="flex flex-col gap-6">
          <SectionHeading id="schools-contact">{t('contact.title')}</SectionHeading>
          <Panel className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <p className="max-w-[48ch] leading-relaxed">{t('contact.body')}</p>
              <a href={mailto} className="self-start font-medium text-primary underline-offset-4 hover:underline">
                {HELLO_EMAIL}
              </a>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <a href={mailto} className={buttonVariants({ variant: 'contrast' })}>
                {t('contact.cta')}
              </a>
              <Link href="/security" className={buttonVariants({ variant: 'outline' })}>
                {t('contact.secondary')}
              </Link>
            </div>
          </Panel>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
