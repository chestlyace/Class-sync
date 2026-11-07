import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import type { SessionUser } from '@/server/core/context'
import { LanguageSwitcher } from './language-switcher'
import { BottomNav, TopNavLinks } from './nav-links'
import { SignOutButton } from './sign-out-button'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((p) => p[0]!.toUpperCase()).join('') || '?'
}

type Section = { href: string; label: string }

/**
 * Floating pill nav with the EN/FR toggle; signed-in users also get the phone bottom nav.
 * `sections` adds in-page links and a "Get started" button for signed-out visitors (landing page).
 */
export async function SiteNav({ user, sections }: { user: SessionUser | null; sections?: Section[] }) {
  const t = await getTranslations()
  return (
    <>
      <header className="sticky top-0 z-40 px-4 pt-3 sm:pt-5">
        <nav
          aria-label={t('nav.main')}
          className="mx-auto flex max-w-5xl items-center justify-between gap-2 rounded-full border bg-background/90 py-1 pr-1 pl-5 backdrop-blur"
        >
          <Link
            href={user ? '/dashboard' : '/'}
            className="font-display text-[26px] leading-none tracking-[0.04em] uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t('common.appName')}
          </Link>
          {user && <TopNavLinks role={user.role} />}
          {!user && sections && (
            <ul
              aria-label={t('landing.nav.sections')}
              className="hidden items-center gap-1 font-mono text-xs font-medium tracking-[0.08em] uppercase lg:flex"
            >
              {sections.map(({ href, label }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="inline-flex h-10 items-center rounded-full px-3.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            {user ? (
              <>
                <span className="hidden max-w-40 truncate px-2 text-sm text-muted-foreground lg:inline">
                  {user.name}
                </span>
                <Link
                  href="/settings"
                  title={t('nav.settings')}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground font-mono text-[13px] font-semibold text-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span aria-hidden="true">{initials(user.name)}</span>
                  <span className="sr-only">
                    {t('nav.account', { name: user.name })} · {t('nav.settings')}
                  </span>
                </Link>
                <SignOutButton />
              </>
            ) : sections ? (
              <>
                {/* max-sm:hidden, not hidden + sm:inline-flex: the button's own inline-flex would win over a plain `hidden`. */}
                <Link href="/sign-in" className={buttonVariants({ variant: 'ghost', className: 'max-sm:hidden' })}>
                  {t('nav.signIn')}
                </Link>
                <Link href="/sign-up" className={buttonVariants({ className: 'bg-foreground text-background hover:bg-foreground/85' })}>
                  {t('landing.nav.getStarted')}
                </Link>
              </>
            ) : (
              <Link href="/sign-in" className={buttonVariants({ variant: 'outline' })}>
                {t('nav.signIn')}
              </Link>
            )}
          </div>
        </nav>
      </header>
      {user && <BottomNav role={user.role} label={t('nav.main')} />}
    </>
  )
}
