import {
  ArrowRight,
  Ban,
  BookOpen,
  Bot,
  Calculator,
  Check,
  ClipboardList,
  Eye,
  Languages,
  PenLine,
  Presentation,
  School,
  Timer,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ExchangeExample, MarkingExample } from '@/components/landing/assistant-examples'
import { AttendanceExample, PhoneExample, ProjectorExample, SubmissionsExample } from '@/components/landing/examples'
import { CaExample, NotesExample, StructureDiagram, TestPhoneExample } from '@/components/landing/product-examples'
import { Reveal } from '@/components/landing/reveal'
import { Logo } from '@/components/logo'
import { Eyebrow } from '@/components/page-header'
import { SiteNav } from '@/components/site-nav'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSessionUser } from '@/server/auth/session'

const container = 'mx-auto w-full max-w-5xl px-4'
const band = 'border-y bg-muted'
const sectionTitle = 'font-display text-6xl leading-[0.9] font-normal text-balance sm:text-7xl'
const lead = 'max-w-[62ch] text-lg leading-relaxed text-subtle'
const cardTitle = 'text-lg font-semibold'
const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
/** The big pill buttons of the hero and the closing call to action. */
const heroButton = 'h-14 px-7 text-base'

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

/** A feature: kicker, title, body and points beside a picture of the product. */
function Feature({
  id,
  kicker,
  title,
  body,
  points,
  visual,
  flip = false,
  shaded = false,
}: {
  id: string
  kicker: string
  title: string
  body: string
  points: string[]
  visual: React.ReactNode
  flip?: boolean
  shaded?: boolean
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-28', shaded && band)}>
      <div className={cn(container, 'grid items-center gap-12 py-24 sm:py-28 lg:grid-cols-2 lg:gap-16')}>
        <div className={cn('flex min-w-0 flex-col gap-5', flip && 'lg:order-2')}>
          <Eyebrow>{kicker}</Eyebrow>
          <h2 id={`${id}-title`} className={sectionTitle}>
            {title}
          </h2>
          <p className={lead}>{body}</p>
          <Points items={points} />
        </div>
        <Reveal className="min-w-0">
          <div data-reveal-item>{visual}</div>
        </Reveal>
      </div>
    </section>
  )
}

export default async function Home() {
  if (await getSessionUser()) redirect('/dashboard')
  const t = await getTranslations('landing')

  const index: { href: string; key: 'attendance' | 'assignments' | 'tests' | 'ca' | 'notes' | 'assistant'; icon: LucideIcon }[] = [
    { href: '#attendance', key: 'attendance', icon: UserCheck },
    { href: '#assignments', key: 'assignments', icon: ClipboardList },
    { href: '#tests', key: 'tests', icon: Timer },
    { href: '#ca', key: 'ca', icon: Calculator },
    { href: '#notes', key: 'notes', icon: BookOpen },
    { href: '#assistant', key: 'assistant', icon: Bot },
  ]
  const replaces = (['attendance', 'assignments', 'marks'] as const).map((key) => ({
    key,
    label: t(`replaces.${key}.label`),
    before: t(`replaces.${key}.before`),
    after: t(`replaces.${key}.after`),
  }))
  const fit: { key: 'schools' | 'shared' | 'languages' | 'devices'; icon: LucideIcon }[] = [
    { key: 'schools', icon: School },
    { key: 'shared', icon: Users },
    { key: 'languages', icon: Languages },
    { key: 'devices', icon: Presentation },
  ]
  const scope: { key: 'reads' | 'drafts' | 'never'; icon: LucideIcon }[] = [
    { key: 'reads', icon: Eye },
    { key: 'drafts', icon: PenLine },
    { key: 'never', icon: Ban },
  ]
  const asks = ['slipping', 'checkIns', 'assignment', 'notes', 'marks'] as const
  const connect = ['url', 'add', 'signIn'] as const
  const lecturerSide = ['checkIn', 'assignments', 'tests', 'ca', 'notes', 'assistant'] as const
  const studentSide = ['join', 'checkIn', 'submit', 'tests', 'ca', 'practice'] as const
  const steps = ['school', 'code', 'checkIn'] as const
  const faq = ['private', 'drafts', 'access', 'data', 'cheating', 'connection', 'install', 'practice'] as const

  return (
    <>
      <SiteNav
        user={null}
        sections={[
          { href: '#features', label: t('nav.features') },
          { href: '#assistant', label: t('nav.assistant') },
          { href: '#how', label: t('nav.how') },
          { href: '#faq', label: t('nav.faq') },
        ]}
      />
      <main className="flex flex-1 flex-col">
        {/* Hero */}
        <section aria-labelledby="hero-title" className={cn(container, 'flex flex-col gap-14 pt-16 pb-16 sm:pt-24 sm:pb-20')}>
          <div className="flex max-w-4xl flex-col gap-6">
            <Eyebrow>{t('hero.eyebrow')}</Eyebrow>
            <h1 id="hero-title" className="font-display text-7xl leading-[0.86] tracking-[0.005em] sm:text-9xl">
              {t('hero.titleLead')} <span className="text-muted-foreground">{t('hero.titleTail')}</span>
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-subtle sm:text-xl">{t('hero.body')}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className={buttonVariants({ size: 'lg', className: heroButton })}>
                {t('hero.lecturerCta')}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
              <Link href="/sign-up" className={buttonVariants({ size: 'lg', variant: 'outline', className: heroButton })}>
                {t('hero.studentCta')}
              </Link>
            </div>
            <a
              href="#assistant"
              className={cn(
                'group inline-flex w-fit items-center gap-2 rounded-full py-1 text-[15px] font-medium text-pretty text-foreground underline-offset-4 hover:underline',
                focusRing,
              )}
            >
              <Bot aria-hidden="true" className="size-[18px] text-primary" strokeWidth={2} />
              <span>
                {t('hero.aiLink')} <span className="text-muted-foreground">{t('hero.aiLinkTail')}</span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </a>
          </div>
          <div className="flex flex-wrap items-stretch gap-5">
            <ProjectorExample className="min-w-0 flex-[3_1_480px]" />
            <PhoneExample className="max-w-[300px] flex-[1_1_240px]" />
          </div>
          <nav id="features" aria-labelledby="index-title" className="flex scroll-mt-28 flex-col gap-3.5">
            <h2 id="index-title">
              <Eyebrow>{t('index.label')}</Eyebrow>
            </h2>
            <ul className="flex flex-wrap gap-2">
              {index.map(({ href, key, icon: Icon }) => (
                <li key={key}>
                  <a
                    href={href}
                    className={cn(
                      'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.97] motion-reduce:active:scale-100',
                      focusRing,
                    )}
                  >
                    <Icon aria-hidden="true" className={cn('size-4', key === 'assistant' ? 'text-primary' : 'text-muted-foreground')} strokeWidth={2} />
                    {t(`index.${key}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </section>

        {/* What it replaces */}
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

        {/* Lecturer → School → Class → Course */}
        <section aria-labelledby="structure-title" className={cn(container, 'flex flex-col gap-12 py-24 sm:py-28')}>
          <div className="flex flex-col gap-5">
            <Eyebrow>{t('structure.kicker')}</Eyebrow>
            <h2 id="structure-title" className={sectionTitle}>
              {t('structure.title')}
            </h2>
            <p className={lead}>{t('structure.body')}</p>
          </div>
          <Reveal>
            <div data-reveal-item>
              <StructureDiagram />
            </div>
          </Reveal>
          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {fit.map(({ key, icon: Icon }) => (
              <li key={key} className="flex flex-col gap-2 border-t pt-5">
                <Icon aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={2} />
                <h3 className="font-semibold">{t(`structure.points.${key}.title`)}</h3>
                <p className="text-[15px] leading-relaxed text-subtle">{t(`structure.points.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <Feature
          id="attendance"
          shaded
          kicker={t('attendance.kicker')}
          title={t('attendance.title')}
          body={t('attendance.body')}
          points={[
            t('attendance.points.twoCheckIns'),
            t('attendance.points.liveCount'),
            t('attendance.points.campus'),
            t('attendance.points.corrections'),
          ]}
          visual={<AttendanceExample />}
        />

        <Feature
          id="assignments"
          flip
          kicker={t('assignments.kicker')}
          title={t('assignments.title')}
          body={t('assignments.body')}
          points={[
            t('assignments.points.drafts'),
            t('assignments.points.formats'),
            t('assignments.points.reminder'),
            t('assignments.points.late'),
            t('assignments.points.release'),
          ]}
          visual={<SubmissionsExample />}
        />

        <Feature
          id="tests"
          shaded
          kicker={t('tests.kicker')}
          title={t('tests.title')}
          body={t('tests.body')}
          points={[
            t('tests.points.start'),
            t('tests.points.types'),
            t('tests.points.timer'),
            t('tests.points.leaving'),
            t('tests.points.results'),
          ]}
          visual={<TestPhoneExample />}
        />

        <Feature
          id="ca"
          flip
          kicker={t('ca.kicker')}
          title={t('ca.title')}
          body={t('ca.body')}
          points={[
            t('ca.points.split'),
            t('ca.points.weights'),
            t('ca.points.participation'),
            t('ca.points.views'),
            t('ca.points.export'),
          ]}
          visual={<CaExample />}
        />

        <Feature
          id="notes"
          shaded
          kicker={t('notes.kicker')}
          title={t('notes.title')}
          body={t('notes.body')}
          points={[t('notes.points.resources'), t('notes.points.share'), t('notes.points.practice'), t('notes.points.fromTest')]}
          visual={<NotesExample />}
        />

        {/* AI assistant over MCP, and suggested marks */}
        <section id="assistant" aria-labelledby="assistant-title" className="scroll-mt-28">
          <div className={cn(container, 'flex flex-col gap-16 py-24 sm:gap-20 sm:py-32')}>
            <div className="flex flex-col gap-5">
              <Eyebrow className="text-primary">{t('assistant.kicker')}</Eyebrow>
              <h2 id="assistant-title" className="max-w-4xl font-display text-6xl leading-[0.88] font-normal text-balance sm:text-8xl">
                {t('assistant.title')}
              </h2>
              <p className={lead}>{t('assistant.body')}</p>
            </div>

            <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
              <div className="flex min-w-0 flex-col gap-10 lg:sticky lg:top-28 lg:order-2">
                <ExchangeExample />
              </div>
              <div className="flex min-w-0 flex-col gap-12 lg:order-1">
                <dl className="flex flex-col">
                  {scope.map(({ key, icon: Icon }) => (
                    <div key={key} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t py-5 last:border-b">
                      <Icon
                        aria-hidden="true"
                        className={cn('row-span-2 mt-0.5 size-5', key === 'never' ? 'text-alert' : 'text-primary')}
                        strokeWidth={2}
                      />
                      <dt className="font-semibold">{t(`assistant.scope.${key}.title`)}</dt>
                      <dd className="text-subtle">{t(`assistant.scope.${key}.body`)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-col gap-4">
                  <h3 className={cardTitle}>{t('assistant.asks.title')}</h3>
                  <ul className="flex flex-col gap-2">
                    {asks.map((key) => (
                      <li
                        key={key}
                        className="w-fit max-w-full rounded-[18px] rounded-bl-md border bg-muted/60 px-4 py-2.5 text-[15px] leading-snug"
                      >
                        {t(`assistant.asks.${key}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <h3 className={cardTitle}>{t('assistant.connect.title')}</h3>
              <ol className="grid gap-x-8 gap-y-6 md:grid-cols-3">
                {connect.map((key, i) => (
                  <li key={key} className="flex flex-col gap-3 border-t pt-5">
                    <span aria-hidden="true" className="font-display text-4xl leading-none text-primary">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p className="leading-relaxed text-subtle">{t(`assistant.connect.${key}`)}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="grid items-center gap-12 rounded-[36px] bg-muted p-5 sm:p-10 lg:grid-cols-2 lg:gap-14 lg:p-12">
              <div className="flex min-w-0 flex-col gap-5 px-1 sm:px-0">
                <Eyebrow>{t('assistant.marking.kicker')}</Eyebrow>
                <h3 className="font-display text-5xl leading-[0.9] font-normal text-balance sm:text-6xl">{t('assistant.marking.title')}</h3>
                <p className="leading-relaxed text-subtle">{t('assistant.marking.body')}</p>
                <Points
                  items={[
                    t('assistant.marking.points.byQuestion'),
                    t('assistant.marking.points.hidden'),
                    t('assistant.marking.points.private'),
                  ]}
                />
              </div>
              <Reveal className="min-w-0">
                <div data-reveal-item>
                  <MarkingExample />
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Lecturer and student */}
        <section aria-labelledby="sides-title" className={band}>
          <div className={cn(container, 'flex flex-col gap-10 py-24 sm:py-28')}>
            <h2 id="sides-title" className={sectionTitle}>
              {t('sides.title')}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  { side: 'lecturer', items: lecturerSide, dark: true },
                  { side: 'student', items: studentSide, dark: false },
                ] as const
              ).map(({ side, items, dark }) => (
                <div
                  key={side}
                  className={cn(
                    'flex flex-col gap-6 rounded-[28px] p-6 sm:p-8',
                    dark ? 'bg-foreground text-background' : 'border bg-background',
                  )}
                >
                  <h3 className="text-2xl font-semibold">{t(`sides.${side}.title`)}</h3>
                  <ul className={cn('flex flex-col divide-y', dark ? 'divide-background/15' : 'divide-border')}>
                    {items.map((key) => (
                      <li key={key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                        <Check
                          aria-hidden="true"
                          className={cn('mt-1 size-4 shrink-0', dark ? 'text-background/70' : 'text-primary')}
                          strokeWidth={2.5}
                        />
                        <span className={cn('leading-relaxed', dark && 'text-background/90')}>{t(`sides.${side}.${key}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-28">
          <div className={cn(container, 'flex flex-col gap-10 py-24 sm:py-28')}>
            <h2 id="how-title" className={sectionTitle}>
              {t('how.title')}
            </h2>
            <ol className="grid gap-x-8 gap-y-8 md:grid-cols-3">
              {steps.map((key, i) => (
                <li key={key} className="flex flex-col gap-3 border-t pt-6">
                  <span aria-hidden="true" className="font-display text-6xl leading-[0.85] text-primary">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className={cardTitle}>{t(`how.${key}.title`)}</h3>
                  <p className="leading-relaxed text-subtle">{t(`how.${key}.body`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Trust */}
        <section id="faq" aria-labelledby="faq-title" className={cn(band, 'scroll-mt-28')}>
          <div className={cn(container, 'flex flex-col gap-10 py-24 sm:py-28')}>
            <h2 id="faq-title" className={sectionTitle}>
              {t('faq.title')}
            </h2>
            <dl className="grid gap-x-12 md:grid-cols-2">
              {faq.map((key) => (
                <div key={key} className="flex flex-col gap-2 border-t py-6">
                  <dt className="text-lg leading-snug font-semibold">{t(`faq.${key}.q`)}</dt>
                  <dd className="leading-relaxed text-subtle">{t(`faq.${key}.a`)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="cta-title" className={cn(container, 'py-24 sm:py-28')}>
          <div className="flex flex-wrap items-end justify-between gap-8 rounded-[32px] bg-foreground lg:flex-nowrap px-6 py-10 text-background sm:px-12 sm:py-14">
            <h2 id="cta-title" className="max-w-[18ch] font-display text-6xl leading-[0.88] font-normal text-balance sm:text-[88px]">
              {t('cta.title')}
            </h2>
            <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/sign-up" className={buttonVariants({ variant: 'inverse', size: 'lg', className: heroButton })}>
                {t('cta.primary')}
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
              <Link href="/sign-in" className={buttonVariants({ variant: 'inverse-outline', size: 'lg', className: heroButton })}>
                {t('cta.secondary')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className={cn(container, 'flex flex-wrap items-center justify-between gap-4 py-8 text-sm text-muted-foreground')}>
          <span className="flex items-center gap-3.5">
            <Logo className="h-5 text-foreground" />
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </span>
          <span className="flex items-center gap-5">
            <Link href="/privacy" className={cn('text-subtle hover:text-foreground', focusRing, 'rounded-full')}>
              {(await getTranslations('privacy'))('link')}
            </Link>
            <a href="https://chestlyace.online" className={cn('text-subtle hover:text-foreground', focusRing, 'rounded-full')}>
              {t('footer.madeBy')}
            </a>
          </span>
        </div>
      </footer>
    </>
  )
}
