import { ArrowRight, GraduationCap, Presentation } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Eyebrow } from '@/components/page-header'
import { SiteNav } from '@/components/site-nav'
import { buttonVariants } from '@/components/ui/button'
import { getSessionUser } from '@/server/auth/session'

export default async function Home() {
  if (await getSessionUser()) redirect('/dashboard')
  const t = await getTranslations()
  return (
    <>
      <SiteNav user={null} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-12 px-4 py-12 sm:py-20">
        <div className="flex max-w-2xl flex-col gap-5">
          <Eyebrow>{t('landing.eyebrow')}</Eyebrow>
          <h1 className="font-display text-6xl leading-[0.92] tracking-[0.01em] sm:text-8xl">{t('landing.title')}</h1>
          <p className="text-lg text-muted-foreground">{t('landing.body')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up" className={buttonVariants({ size: 'lg' })}>
              {t('nav.signUp')}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
            <Link href="/sign-in" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              {t('nav.signIn')}
            </Link>
          </div>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {(
            [
              { icon: Presentation, title: t('landing.lecturerTitle'), body: t('landing.lecturerBody') },
              { icon: GraduationCap, title: t('landing.studentTitle'), body: t('landing.studentBody') },
            ] as const
          ).map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex flex-col gap-3 rounded-3xl border bg-muted p-6">
              <Icon aria-hidden="true" className="size-5" />
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
