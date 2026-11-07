import { ArrowRight, Check, Languages, School, Smartphone, Users, type LucideIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AttendanceExample, PhoneExample, ProjectorExample, SubmissionsExample } from '@/components/landing/examples'
import { Eyebrow } from '@/components/page-header'
import { SiteNav } from '@/components/site-nav'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth/session'

const container = 'mx-auto w-full max-w-5xl px-4'
const band = 'border-y bg-muted'
const sectionTitle = 'font-display text-6xl leading-[0.9] font-normal sm:text-7xl'
const cardTitle = 'text-lg font-semibold'

function Points({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <Check aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" strokeWidth={2.5} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default async function Home() {
  if (await getSessionUser()) redirect('/dashboard')
  const t = await getTranslations('landing')

  const replaces = (['attendance', 'assignments', 'marks'] as const).map((key) => ({
    key,
    label: t(`replaces.${key}.label`),
    before: t(`replaces.${key}.before`),
    after: t(`replaces.${key}.after`),
  }))
  const fit: { key: 'schools' | 'shared' | 'languages' | 'data'; icon: LucideIcon }[] = [
    { key: 'schools', icon: School },
    { key: 'shared', icon: Users },
    { key: 'languages', icon: Languages },
    { key: 'data', icon: Smartphone },
  ]
  const steps = ['school', 'code', 'checkIn'] as const
  const next = ['ca', 'tests', 'notes', 'assistant'] as const

  return (
    <>
      <SiteNav
        user={null}
        sections={[
          { href: '#attendance', label: t('nav.attendance') },
          { href: '#assignments', label: t('nav.assignments') },
          { href: '#how', label: t('nav.how') },
        ]}
      />
      <main className="flex flex-1 flex-col">
        <section aria-labelledby="hero-title" className={cn(container, 'flex flex-col gap-14 pt-16 pb-20 sm:pt-24 sm:pb-24')}>
          <div className="flex max-w-4xl flex-col gap-6">
            <Eyebrow>{t('hero.eyebrow')}</Eyebrow>
            <h1 id="hero-title" className="font-display text-7xl leading-[0.86] tracking-[0.005em] sm:text-9xl">
              {t('hero.titleLead')} <span className="text-muted-foreground">{t('hero.titleTail')}</span>
            </h1>
            <p className="max-w-2xl text-lg text-[#48484a] sm:text-xl">{t('hero.body')}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className={buttonVariants({ size: 'lg', className: 'h-14 px-7 text-base' })}>
                {t('hero.lecturerCta')}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
              <Link href="/sign-up" className={buttonVariants({ size: 'lg', variant: 'outline', className: 'h-14 px-7 text-base' })}>
                {t('hero.studentCta')}
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-stretch gap-5">
            <ProjectorExample className="min-w-0 flex-[3_1_480px]" />
            <PhoneExample className="max-w-[300px] flex-[1_1_240px]" />
          </div>
        </section>

        <section aria-labelledby="replaces-title" className={band}>
          <div className={cn(container, 'flex flex-col gap-9 py-20 sm:py-24')}>
            <h2 id="replaces-title" className={sectionTitle}>
              {t('replaces.title')}
            </h2>
            <ul className="grid gap-4 md:grid-cols-3">
              {replaces.map(({ key, label, before, after }) => (
                <li key={key} className="flex flex-col gap-4 rounded-3xl border bg-background p-6">
                  <Eyebrow className="font-semibold">{label}</Eyebrow>
                  <p className="text-muted-foreground line-through decoration-border">{before}</p>
                  <p className="text-lg leading-snug font-semibold">{after}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="attendance"
          aria-labelledby="attendance-title"
          className={cn(container, 'flex scroll-mt-28 flex-wrap items-center gap-14 py-24 sm:py-28')}
        >
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
            <Eyebrow>{t('attendance.kicker')}</Eyebrow>
            <h2 id="attendance-title" className={sectionTitle}>
              {t('attendance.title')}
            </h2>
            <p className="text-lg text-[#48484a]">{t('attendance.body')}</p>
            <Points
              items={[
                t('attendance.points.twoCheckIns'),
                t('attendance.points.liveCount'),
                t('attendance.points.campus'),
                t('attendance.points.corrections'),
              ]}
            />
          </div>
          <AttendanceExample className="min-w-0 flex-[1_1_420px]" />
        </section>

        <section id="assignments" aria-labelledby="assignments-title" className={cn(band, 'scroll-mt-28')}>
          <div className={cn(container, 'flex flex-wrap-reverse items-center gap-14 py-24 sm:py-28')}>
            <SubmissionsExample className="min-w-0 flex-[1_1_420px]" />
            <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
              <Eyebrow>{t('assignments.kicker')}</Eyebrow>
              <h2 id="assignments-title" className={sectionTitle}>
                {t('assignments.title')}
              </h2>
              <p className="text-lg text-[#48484a]">{t('assignments.body')}</p>
              <Points
                items={[
                  t('assignments.points.formats'),
                  t('assignments.points.late'),
                  t('assignments.points.release'),
                  t('assignments.points.private'),
                ]}
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="fit-title" className={cn(container, 'flex flex-col gap-9 py-24 sm:py-28')}>
          <h2 id="fit-title" className={sectionTitle}>
            {t('fit.title')}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fit.map(({ key, icon: Icon }) => (
              <li key={key} className="flex flex-col gap-2.5 rounded-3xl border p-6">
                <Icon aria-hidden="true" className="size-6" />
                <h3 className={cardTitle}>{t(`fit.${key}.title`)}</h3>
                <p className="text-[#48484a]">{t(`fit.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" aria-labelledby="how-title" className={cn(band, 'scroll-mt-28')}>
          <div className={cn(container, 'flex flex-col gap-10 py-24 sm:py-28')}>
            <h2 id="how-title" className={sectionTitle}>
              {t('how.title')}
            </h2>
            <ol className="grid gap-4 md:grid-cols-3">
              {steps.map((key, i) => (
                <li key={key} className="flex flex-col gap-3 rounded-3xl border bg-background p-6">
                  <span aria-hidden="true" className="font-display text-6xl leading-[0.85] text-primary">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className={cardTitle}>{t(`how.${key}.title`)}</h3>
                  <p className="text-[#48484a]">{t(`how.${key}.body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="next-title" className={cn(container, 'flex flex-wrap gap-10 py-24 sm:py-28')}>
          <div className="flex flex-[1_1_300px] flex-col gap-3.5">
            <Eyebrow>{t('next.kicker')}</Eyebrow>
            <h2 id="next-title" className={sectionTitle}>
              {t('next.title')}
            </h2>
          </div>
          <ul className="flex flex-[2_1_440px] flex-col">
            {next.map((key) => (
              <li key={key} className="flex flex-wrap justify-between gap-x-6 gap-y-2 border-b py-4.5">
                <span className={cardTitle}>{t(`next.${key}.title`)}</span>
                <span className="text-muted-foreground">{t(`next.${key}.body`)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="cta-title" className={cn(container, 'pb-24 sm:pb-28')}>
          <div className="flex flex-wrap items-center justify-between gap-7 rounded-[32px] bg-foreground px-8 py-12 text-background sm:px-12 sm:py-14">
            <h2 id="cta-title" className="font-display text-6xl leading-[0.88] font-normal sm:text-[88px]">
              {t('cta.title')}
            </h2>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className={buttonVariants({
                  size: 'lg',
                  className: 'h-14 bg-background px-7 text-base font-semibold text-foreground hover:bg-background/90',
                })}
              >
                {t('cta.primary')}
              </Link>
              <Link
                href="/sign-in"
                className={buttonVariants({
                  size: 'lg',
                  variant: 'outline',
                  className:
                    'h-14 border-muted-foreground bg-transparent px-6 text-base text-background hover:bg-background/10 hover:text-background',
                })}
              >
                {t('cta.secondary')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className={cn(container, 'flex flex-wrap items-center justify-between gap-4 py-8 text-sm text-muted-foreground')}>
          <span className="flex items-center gap-3.5">
            <span className="font-display text-[22px] tracking-[0.04em] text-foreground uppercase">Clasync</span>
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </span>
          <a href="https://chestlyace.online" className="text-[#48484a] hover:text-foreground">
            {t('footer.madeBy')}
          </a>
        </div>
      </footer>
    </>
  )
}
