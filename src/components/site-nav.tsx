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

/** Floating pill nav with the EN/FR toggle; signed-in users also get the phone bottom nav. */
export async function SiteNav({ user }: { user: SessionUser | null }) {
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
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            {user ? (
              <>
                <span className="hidden max-w-40 truncate px-2 text-sm text-muted-foreground lg:inline">
                  {user.name}
                </span>
                <span
                  title={t('nav.account', { name: user.name })}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground font-mono text-[13px] font-semibold text-background"
                >
                  <span aria-hidden="true">{initials(user.name)}</span>
                  <span className="sr-only">{t('nav.account', { name: user.name })}</span>
                </span>
                <SignOutButton />
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
